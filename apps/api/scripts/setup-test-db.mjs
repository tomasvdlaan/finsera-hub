/**
 * Create the test database (if absent) and migrate it.
 *
 * Kept separate from the dev database on purpose: the test suite truncates tables, so
 * sharing one database would mean `pnpm test` wipes whatever you were working with.
 */
import { execSync } from 'node:child_process';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://platform:platform@localhost:5432/platform_test';
const dbName = new URL(url).pathname.slice(1);
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';

const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (rowCount === 0) {
  await admin.query(`CREATE DATABASE "${dbName}"`);
  console.log(`Created database ${dbName}`);
} else {
  console.log(`Database ${dbName} already exists`);
}
await admin.end();

execSync('pnpm exec drizzle-kit migrate', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});
console.log(`Migrated ${dbName}`);
