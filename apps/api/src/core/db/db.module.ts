import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as coreSchema from './core.schema.js';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

export type Database = NodePgDatabase<typeof coreSchema>;
/** A transaction handle. Core services accept this so registry writes, events, and the
 *  module's own row all commit together — the invariant the whole architecture rests on. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run a query. Writes should always be passed a Tx. */
export type Executor = Database | Tx;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () =>
        new Pool({
          connectionString:
            process.env.DATABASE_URL ?? 'postgres://platform:platform@localhost:5432/platform',
        }),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema: coreSchema }),
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    // pool is closed by Nest's provider teardown in practice; explicit hook kept for clarity
  }
}
