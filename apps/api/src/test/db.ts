import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as coreSchema from '../core/db/core.schema.js';

/**
 * Integration-test database — SEPARATE from the development database.
 *
 * These services exist to guarantee transactional behaviour, which a mock cannot prove,
 * so the tests run against real Postgres. But they TRUNCATE between cases: pointed at
 * the dev database they would wipe it, and from Phase 2 that database holds real
 * dogfooding data. Hence a dedicated database plus the guard below.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://platform:platform@localhost:5432/platform_test';

if (!/_test(\?|$)/.test(TEST_DATABASE_URL)) {
  throw new Error(
    `Refusing to run tests against '${TEST_DATABASE_URL}' — the database name must end ` +
      `in '_test'. Tests truncate tables; pointing them at a real database destroys data.`,
  );
}

export const testPool = new Pool({ connectionString: TEST_DATABASE_URL });

export const testDb: NodePgDatabase<typeof coreSchema> = drizzle(testPool, { schema: coreSchema });

/** Wipe core tables between tests. Order handled by CASCADE. */
export async function resetDb(): Promise<void> {
  await testDb.execute(
    sql`TRUNCATE core.audit_log, core.event_deliveries, core.events, core.links, core.entities, core.files, core.users RESTART IDENTITY CASCADE`,
  );
}

export async function closeDb(): Promise<void> {
  await testPool.end();
}

/**
 * Insert a user row for a test actor. Needed because links and audit records carry
 * foreign keys to core.users — an actor that exists only in memory is not a real actor.
 */
export async function seedUser(
  userId: string,
  role: 'admin' | 'member' = 'member',
): Promise<void> {
  await testDb.insert(coreSchema.users).values({
    id: userId,
    oidcSubject: `test|${userId}`,
    email: `${userId}@test.local`,
    displayName: 'Test User',
    role,
  });
}
