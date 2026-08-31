import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

const LOCK_KEY = 8_675_309; // arbitrary but fixed — same key across all instances

/**
 * Run pending migrations at startup, guarded by a Postgres advisory lock (spec §9).
 *
 * One instance today, but the lock costs nothing and means a second one starting
 * concurrently waits rather than racing the same DDL. Deploy is then just "start the
 * new container" — no separate migration step to forget.
 */
export async function runMigrations(migrationsFolder: string): Promise<void> {
  const logger = new Logger('Migrator');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const db = drizzle(pool);
    await db.execute(sql`SELECT pg_advisory_lock(${LOCK_KEY})`);
    try {
      await migrate(db, { migrationsFolder });
      await assertNothingSkipped(db, migrationsFolder, logger);
      logger.log('Migrations up to date');
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`);
    }
  } finally {
    await pool.end();
  }
}


/**
 * Every migration in the journal has actually been applied.
 *
 * `migrate()` applies the ones NEWER than the newest already applied, and says nothing about
 * the rest. That is fine until a migration is renumbered into the middle of the sequence: one
 * whose timestamp lands below the high-water mark is skipped, silently, and skipped again on
 * every deploy afterwards. It never retries and nothing reports it.
 *
 * That happened. `0045_project_members` was dated between 0044 and 0046 after 0046 had already
 * shipped, so production never created `crm.project_members` — while every local and CI
 * database, built from scratch in order, had it. The failure surfaced weeks later as an
 * assistant that could not read a meeting note, because the visibility check queried a table
 * that was not there.
 *
 * Counting is enough, and is what makes this general: it needs no list of tables to keep in
 * step with the schema, and it catches the next skipped migration whatever that one creates.
 * Applied may legitimately EXCEED the journal — a migration re-dated to unstick it runs a
 * second time on databases that already had it — so only a shortfall is a fault.
 *
 * Throws, because this runs before the app accepts traffic and the container's health check is
 * what the deploy watches: a database missing a migration should fail the deploy loudly rather
 * than serve requests that will fail one at a time, later, somewhere else.
 */
async function assertNothingSkipped(
  db: ReturnType<typeof drizzle>,
  migrationsFolder: string,
  logger: Logger,
): Promise<void> {
  let expected: number;
  try {
    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: unknown[] };
    expected = journal.entries.length;
  } catch (err) {
    // A missing journal is a packaging problem, not a schema one. Say so and carry on rather
    // than refusing to boot over a check that cannot run.
    logger.warn(`Could not read the migration journal (${(err as Error).message})`);
    return;
  }

  const rows = await db.execute(
    sql`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations`,
  );
  const applied = Number((rows.rows[0] as { applied: number } | undefined)?.applied ?? 0);

  if (applied < expected) {
    throw new Error(
      `The database has ${applied} of ${expected} migrations. ` +
        'One was skipped — almost always a migration dated below the newest already applied, ' +
        'which drizzle never retries. Re-date its `when` in drizzle/meta/_journal.json to ' +
        'above the current maximum and deploy again; migrations are written to be safe to ' +
        're-run.',
    );
  }
}
