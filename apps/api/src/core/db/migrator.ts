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
      logger.log('Migrations up to date');
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`);
    }
  } finally {
    await pool.end();
  }
}
