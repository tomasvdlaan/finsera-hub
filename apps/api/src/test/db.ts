import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql, type SQL } from 'drizzle-orm';
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
/**
 * The only way tests are allowed to empty a table.
 *
 * `core.audit_log` is append-only in the database, TRUNCATE included — and because
 * `audit_log.actor_id` references `core.users`, even `TRUNCATE core.users CASCADE` reaches
 * it. Tests need a clean slate, so this is the single sanctioned bypass: narrow (that one
 * guard), central (this function), and re-armed in a `finally`, so a test would have to
 * work at it to leave the guard off.
 *
 * The trigger stays live during tests, which is the point — `audit-log-immutable.spec.ts`
 * asserts against the real thing rather than against a version relaxed for convenience.
 * Production has no equivalent path: pruning means a migration.
 */
export async function truncate(statement: SQL): Promise<void> {
  await testDb.execute(sql`ALTER TABLE core.audit_log DISABLE TRIGGER audit_log_no_truncate`);
  try {
    await testDb.execute(statement);
  } finally {
    await testDb.execute(sql`ALTER TABLE core.audit_log ENABLE TRIGGER audit_log_no_truncate`);
  }
}

export async function resetDb(): Promise<void> {
  await truncate(
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
  /** Named, for the tests where two people have to be told apart — mentions, mostly. */
  displayName = 'Test User',
): Promise<void> {
  await testDb.insert(coreSchema.users).values({
    id: userId,
    oidcSubject: `test|${userId}`,
    email: `${userId}@test.local`,
    displayName,
    role,
  });
}
