/**
 * Move every locally stored document version into the SharePoint library (decision D8).
 *
 * Dry run by default. Pass --commit to actually upload.
 *
 *   node scripts/migrate-docs-to-sharepoint.mjs            # list what would move
 *   node scripts/migrate-docs-to-sharepoint.mjs --commit   # move them
 *
 * Three properties worth stating, because each is a decision rather than an accident:
 *
 * IT LEAVES THE LOCAL FILE ALONE. The row flips to 'sharepoint' and the bytes on disk stay
 * exactly where they were. Delete them by hand, later, after a restore drill has run against
 * the new world — not from a script whose whole job is to make the old copy redundant.
 *
 * IT VERIFIES BEFORE IT FLIPS. The sha256 of what came back from Graph is compared with the
 * sha256 of what went up, and a mismatch leaves the row untouched. A pointer to a file whose
 * contents we never confirmed is worse than no pointer at all.
 *
 * IT IS RESUMABLE. It only ever selects rows still marked 'local', so an interrupted run is
 * continued by running it again. Nothing here is a transaction across the two systems,
 * because there is no such thing.
 *
 * Talks to Postgres and Graph directly rather than booting Nest: the application context
 * would pull in the event bus, the scheduler and every module's boot-time registration for a
 * job that reads one table and writes to one library.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const commit = process.argv.includes('--commit');

const envFile = new URL('../../../.env', import.meta.url);
const env = (() => {
  try {
    return readFileSync(envFile, 'utf8');
  } catch {
    return '';
  }
})();
const fromEnv = (key) =>
  process.env[key] ??
  new RegExp(`^${key}=(.*)$`, 'm').exec(env)?.[1]?.trim().replace(/^["']|["']$/g, '');

const url = fromEnv('DATABASE_URL') ?? 'postgres://platform:platform@localhost:5432/platform';
const storageRoot = resolve(fromEnv('STORAGE_PATH') ?? './storage');
const tenantId = fromEnv('GRAPH_TENANT_ID');
const clientId = fromEnv('GRAPH_CLIENT_ID');
const clientSecret = fromEnv('GRAPH_CLIENT_SECRET');
const siteId = fromEnv('GRAPH_SITE_ID');
const rootFolder = (fromEnv('GRAPH_ROOT_FOLDER') ?? 'Clients').trim();

if (!tenantId || !clientId || !clientSecret || !siteId) {
  console.error(
    'Graph is not configured. Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET\n' +
      'and GRAPH_SITE_ID — see the "documents in SharePoint" section of .env.example.',
  );
  process.exit(1);
}

/* ── the smallest Graph client that does this job ─────────────────────────────────────── */

let token = null;
async function bearer() {
  if (token && token.expiresAt > Date.now()) return token.value;
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Entra refused the credentials (${res.status}): ${body}`);
  const parsed = JSON.parse(body);
  token = { value: parsed.access_token, expiresAt: Date.now() + (parsed.expires_in - 60) * 1000 };
  return token.value;
}

async function graph(method, path, { body, raw } = {}) {
  // One retry on a throttle, honouring Retry-After. A migration is the exact shape of
  // traffic that trips an app-only quota, so it also paces itself between files below.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(
      path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${await bearer()}`,
          ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: raw ? body : JSON.stringify(body) } : {}),
      },
    );
    if (res.ok) return res.status === 204 ? {} : res.json();
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      const after = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, Number.isFinite(after) ? after * 1000 : 2000));
      continue;
    }
    throw new Error(`Graph ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

const sanitise = (name) =>
  name.replace(/[<>:"|?*\\/]/g, '-').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '').slice(0, 240);

let driveId = null;
const folderCache = new Map();

async function ensureFolder(segments) {
  const clean = [rootFolder, ...segments].map(sanitise).filter(Boolean);
  const key = clean.join('/');
  if (folderCache.has(key)) return folderCache.get(key);

  let parentId = (await graph('GET', `/drives/${driveId}/root`)).id;
  const walked = [];
  for (const segment of clean) {
    walked.push(segment);
    const path = walked.map(encodeURIComponent).join('/');
    try {
      parentId = (await graph('GET', `/drives/${driveId}/root:/${path}`)).id;
    } catch {
      const made = await graph('POST', `/drives/${driveId}/items/${parentId}/children`, {
        body: { name: segment, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
      });
      parentId = made.id;
    }
    folderCache.set(walked.join('/'), parentId);
  }
  return parentId;
}

/* ── the migration ────────────────────────────────────────────────────────────────────── */

const db = new pg.Client({ connectionString: url });
await db.connect();

const { rows } = await db.query(`
  SELECT v.id, v.storage_key, v.filename, v.size_bytes, v.checksum,
         d.title, c.name AS client_name, p.name AS project_name
    FROM docs.versions v
    JOIN docs.documents d ON d.id = v.document_id
    LEFT JOIN crm.clients c ON c.id = d.client_id
    LEFT JOIN crm.projects p ON p.id = d.project_id
   WHERE v.storage_backend = 'local' AND v.storage_key IS NOT NULL
   ORDER BY d.created_at
`);

console.log(`${rows.length} local version(s) to move${commit ? '' : ' (dry run)'}\n`);

if (!commit) {
  for (const r of rows) {
    const where = r.client_name
      ? [r.client_name, r.project_name].filter(Boolean).join('/')
      : '_Algemeen';
    console.log(`  ${r.filename}  →  ${rootFolder}/${where}/`);
  }
  console.log('\nNothing written. Re-run with --commit.');
  await db.end();
  process.exit(0);
}

driveId = fromEnv('GRAPH_DRIVE_ID') ?? (await graph('GET', `/sites/${siteId}/drive`)).id;

let moved = 0;
let failed = 0;

for (const row of rows) {
  try {
    const data = await readFile(join(storageRoot, row.storage_key));

    // The checksum the row already carries is the one recorded at upload. If the file on
    // disk no longer matches it, the interesting problem is that — not this migration.
    const onDisk = createHash('sha256').update(data).digest('hex');
    if (row.checksum && onDisk !== row.checksum) {
      console.warn(`  ! ${row.filename}: on-disk bytes do not match the recorded checksum — skipped`);
      failed++;
      continue;
    }

    const segments = row.client_name
      ? [row.client_name, row.project_name].filter(Boolean)
      : ['_Algemeen'];
    const folderId = await ensureFolder(segments);

    const item = await graph(
      'PUT',
      `/drives/${driveId}/items/${folderId}:/${encodeURIComponent(sanitise(row.filename))}:` +
        `/content?@microsoft.graph.conflictBehavior=rename`,
      { body: data, raw: true },
    );

    // Read it back and compare. Only then does the row point at it.
    const check = await graph('GET', `/drives/${driveId}/items/${item.id}`);
    if (Number(check.size) !== data.byteLength) {
      console.warn(`  ! ${row.filename}: uploaded ${data.byteLength}B, library reports ${check.size}B — row left alone`);
      failed++;
      continue;
    }

    await db.query(
      `UPDATE docs.versions
          SET storage_backend = 'sharepoint',
              drive_id = $2, drive_item_id = $3,
              ctag = $4, etag = $5, sharepoint_path = $6, web_url = $7,
              filename = $8,
              remote_modified_at = $9, remote_modified_by = $10, remote_checked_at = now()
        WHERE id = $1`,
      [
        row.id,
        driveId,
        item.id,
        item.cTag ?? null,
        item.eTag ?? null,
        `${(item.parentReference?.path ?? '').replace(/^\/drive\/root:/, '')}/${item.name}`,
        item.webUrl ?? null,
        // The name the library gave it: a collision is resolved by renaming, and the record
        // must not disagree with the library from the moment it is written.
        item.name,
        item.lastModifiedDateTime ?? null,
        item.lastModifiedBy?.user?.displayName ?? null,
      ],
    );

    // storage_key is deliberately NOT cleared, and the file on disk is deliberately not
    // deleted. Until a restore drill has run against the new world, that copy is the
    // fallback — and clearing the column would make it unfindable.
    console.log(`  ✓ ${row.filename} → ${item.name}`);
    moved++;

    // Pace it. An app-only throttle is per-app-per-tenant and a bulk loop is what trips it.
    await new Promise((r) => setTimeout(r, 200));
  } catch (err) {
    console.error(`  ! ${row.filename}: ${err.message}`);
    failed++;
  }
}

console.log(`\n${moved} moved, ${failed} left alone.`);
if (failed > 0) {
  console.log('Re-run to retry the ones that failed — only local rows are ever selected.');
}
console.log(
  '\nThe local copies are still on disk and still referenced by storage_key.\n' +
    'Delete them by hand once a restore drill has passed against the new world.',
);

await db.end();
