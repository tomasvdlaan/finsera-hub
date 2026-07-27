import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as coreSchema from '../core/db/core.schema.js';

/**
 * Integration-test database.
 *
 * These services exist to guarantee transactional behaviour — that a registry entry and
 * a module row commit or fail together. A mocked database cannot prove that, so the
 * tests run against a real Postgres (docker compose locally, a service container in CI).
 */
export const testPool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://platform:platform@localhost:5432/platform',
});

export const testDb: NodePgDatabase<typeof coreSchema> = drizzle(testPool, { schema: coreSchema });

/** Wipe core tables between tests. Order respects foreign keys. */
export async function resetDb(): Promise<void> {
  await testDb.execute(
    sql`TRUNCATE core.audit_log, core.event_deliveries, core.events, core.links, core.entities, core.files, core.users RESTART IDENTITY CASCADE`,
  );
}

export async function closeDb(): Promise<void> {
  await testPool.end();
}
