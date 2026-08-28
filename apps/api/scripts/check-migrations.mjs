/**
 * The migrations must build the database the schema describes.
 *
 * `drizzle-kit generate` writes a snapshot of what the *TypeScript schema* said at the time and
 * diffs the next migration against that snapshot. It never reads the SQL. For a generated
 * migration the two therefore agree by construction — but eleven of ours are hand-written
 * (every migration with a descriptive name rather than a drizzle codename), and nothing has
 * ever compared their SQL against the schema they are supposed to implement.
 *
 * A hand-written migration that leaves a column nullable where the schema says `.notNull()`,
 * or that quietly omits an index, ships green: the test database is built by those same
 * migrations, so both sides are wrong in the same direction and agree with each other. The
 * next `generate` then bakes the schema's version into a snapshot, and from that point the
 * drift is invisible to `generate` as well.
 *
 * So this builds a real database from the migrations, asks drizzle to push the schema onto it,
 * and compares the structure either side of that push. Anything the push had to add is
 * something the migrations were supposed to build and did not.
 *
 * Deliberately a script rather than a test, for the same reason as the checks in /scripts: it
 * needs a database of its own, and the API suite's fixtures assume one that is already
 * migrated.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const API = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The schema filter is read from the drizzle config rather than restated here, so that a new
// schema namespace cannot be added to the app and forgotten in this check — which would not
// fail, it would silently stop looking at that namespace.
const config = (await import(pathToFileURL(join(API, 'drizzle.config.ts')))).default;
const SCHEMAS = config.schemaFilter;

const url = new URL(process.env.DATABASE_URL ?? config.dbCredentials.url);
const source = url.pathname.slice(1);

// The scratch database is dropped without asking, and its name is interpolated into that
// DROP. Hence both halves of this: the suffix keeps it off the development database whose
// URL it is derived from, and the identifier check means a name that could break out of the
// quotes — or a URL this script has simply misread — stops here rather than at the DROP.
if (!/^[A-Za-z0-9_]+$/.test(source)) {
  console.error(`\nRefusing to derive a scratch database from ${JSON.stringify(source)}.\n`);
  process.exit(1);
}
const scratch = `${source}_migration_check`;

const scratchUrl = new URL(url);
scratchUrl.pathname = `/${scratch}`;
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';

const onScratch = { ...process.env, DATABASE_URL: scratchUrl.toString() };
const drizzleKit = (...args) =>
  execFileSync('pnpm', ['exec', 'drizzle-kit', ...args], {
    cwd: API,
    // Progress chatter on stdout is noise; a real failure goes to stderr and should be seen.
    stdio: ['ignore', 'ignore', 'inherit'],
    env: onScratch,
  });

/** DROP ... WITH (FORCE): an interrupted earlier run leaves a connection a plain DROP waits on. */
async function dropScratch() {
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
  await admin.end();
}

/**
 * What actually exists, as Postgres reports it.
 *
 * Constraints and indexes are keyed by their *definition* rather than their name. A
 * hand-written migration usually lets Postgres name a key (`project_members_pkey`) where the
 * schema names it explicitly (`project_members_project_id_user_id_pk`); that is the same key
 * spelled two ways, and failing on it would mean rewriting working migrations to satisfy a
 * naming convention nothing enforces. A column, by contrast, *is* identified by its name.
 */
async function structure() {
  const client = new pg.Client({ connectionString: scratchUrl.toString() });
  await client.connect();
  const rows = async (text) => (await client.query(text, [SCHEMAS])).rows;

  const columns = new Map();
  for (const r of await rows(
    `SELECT table_schema s, table_name t, column_name c, data_type d, udt_name u,
            is_nullable n, column_default df, character_maximum_length ml,
            numeric_precision np, numeric_scale ns
       FROM information_schema.columns WHERE table_schema = ANY($1)`,
  )) {
    // information_schema reports every user-defined type as the single data_type
    // 'USER-DEFINED', which would make `vector` and any other extension type indistinguishable.
    // udt_name is the one that actually names them.
    const type = r.d === 'USER-DEFINED' || r.d === 'ARRAY' ? r.u : r.d;
    columns.set(
      `${r.s}.${r.t}.${r.c}`,
      `${type} null=${r.n} default=${r.df ?? '-'} len=${r.ml ?? '-'} precision=${r.np ?? '-'}/${r.ns ?? '-'}`,
    );
  }

  const constraints = new Set();
  for (const r of await rows(
    `SELECT n.nspname s, cl.relname t, pg_get_constraintdef(con.oid) d
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE n.nspname = ANY($1)`,
  )) {
    constraints.add(`${r.s}.${r.t} :: ${r.d}`);
  }

  const indexes = new Set();
  for (const r of await rows(
    `SELECT schemaname s, tablename t, indexdef d FROM pg_indexes WHERE schemaname = ANY($1)`,
  )) {
    indexes.add(`${r.s}.${r.t} :: ${r.d.replace(/^CREATE (UNIQUE )?INDEX \S+ ON /, 'CREATE $1INDEX ON ')}`);
  }

  await client.end();
  return { columns, constraints, indexes };
}

await dropScratch();
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`CREATE DATABASE "${scratch}"`);
await admin.end();

try {
  // Ground truth: what the SQL in drizzle/ actually builds, applied in journal order.
  drizzleKit('migrate');
  const built = await structure();

  // --force auto-approves destructive statements, which would be reckless anywhere but here:
  // this database was created seconds ago, holds no rows, and is dropped in the finally below.
  drizzleKit('push', '--force');
  const declared = await structure();

  const behind = [];
  for (const [column, shape] of declared.columns) {
    const was = built.columns.get(column);
    if (was === undefined) behind.push(`column ${column} was never created — schema declares ${shape}`);
    else if (was !== shape) {
      behind.push(`column ${column}\n      migrations build: ${was}\n      schema declares:  ${shape}`);
    }
  }
  for (const c of declared.constraints) if (!built.constraints.has(c)) behind.push(`constraint ${c}`);
  for (const i of declared.indexes) if (!built.indexes.has(i)) behind.push(`index ${i}`);

  if (behind.length > 0) {
    console.error(
      `\n${behind.length} thing(s) the schema declares that the migrations do not build:\n`,
    );
    for (const b of behind) console.error(`  ${b}`);
    console.error(
      '\nA database built from drizzle/ does not match src/**/*.schema.ts. The tests will not\n' +
        'catch this — they run against a database built by these same migrations, so both sides\n' +
        'are wrong together. Either fix the migration, or add one for the schema change.\n',
    );
    // Not process.exit(): that skips the finally below and leaves the scratch database behind.
    process.exitCode = 1;
  } else {
    // The other direction is not an error. Migrations legitimately add things the schema cannot
    // express — CHECK constraints, the hnsw vector index, foreign keys drizzle does not declare.
    // Those show up as structures push would remove, and are exactly the point of writing SQL
    // by hand, so they are counted rather than complained about.
    const extra =
      [...built.constraints].filter((c) => !declared.constraints.has(c)).length +
      [...built.indexes].filter((i) => !declared.indexes.has(i)).length;
    console.log(
      `✔ migrations build the schema across ${SCHEMAS.length} namespaces ` +
        `(${built.columns.size} columns; ${extra} SQL-only constraints and indexes left alone)`,
    );
  }
} finally {
  await dropScratch();
}
