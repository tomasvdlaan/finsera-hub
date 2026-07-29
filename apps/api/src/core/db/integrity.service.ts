import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Database } from './db.module.js';

/**
 * Every database guarantee this platform relies on, listed by name.
 *
 * These triggers are not optimisations — they are the reason an issued invoice, a sent
 * quote, a signed contract and an invoiced hour cannot be rewritten. A service can be
 * bypassed; a trigger cannot. If one is missing, the guarantee is gone and nothing in the
 * application would otherwise notice.
 */
const REQUIRED_TRIGGERS: Array<{ schema: string; table: string; trigger: string; guards: string }> =
  [
    {
      schema: 'core',
      table: 'audit_log',
      trigger: 'audit_log_no_update',
      guards: 'audit entries cannot be altered',
    },
    {
      schema: 'core',
      table: 'audit_log',
      trigger: 'audit_log_no_delete',
      guards: 'audit entries cannot be deleted',
    },
    {
      schema: 'core',
      table: 'audit_log',
      trigger: 'audit_log_no_truncate',
      guards: 'the audit log cannot be emptied in one statement',
    },
    {
      schema: 'billing',
      table: 'invoices',
      trigger: 'invoices_immutable_after_issue',
      guards: 'issued invoices cannot be altered',
    },
    {
      schema: 'billing',
      table: 'invoices',
      trigger: 'invoices_no_delete_after_issue',
      guards: 'issued invoices cannot be deleted',
    },
    {
      schema: 'billing',
      table: 'invoice_lines',
      trigger: 'invoice_lines_immutable_after_issue',
      guards: 'issued invoice lines cannot be altered',
    },
    {
      schema: 'time',
      table: 'entries',
      trigger: 'entries_immutable_when_invoiced',
      guards: 'invoiced hours cannot be altered',
    },
    {
      schema: 'time',
      table: 'entries',
      trigger: 'entries_no_delete_when_invoiced',
      guards: 'invoiced hours cannot be deleted',
    },
    {
      schema: 'sales',
      table: 'quotes',
      trigger: 'quotes_immutable_after_send',
      guards: 'sent quotes cannot be altered',
    },
    {
      schema: 'sales',
      table: 'quotes',
      trigger: 'quotes_no_delete_after_send',
      guards: 'sent quotes cannot be deleted',
    },
    {
      schema: 'sales',
      table: 'quote_lines',
      trigger: 'quote_lines_immutable_after_send',
      guards: 'sent quote lines cannot be altered',
    },
    {
      schema: 'sales',
      table: 'contracts',
      trigger: 'contracts_immutable_after_sign',
      guards: 'signed contract terms cannot be altered',
    },
    {
      schema: 'sales',
      table: 'contracts',
      trigger: 'contracts_no_delete_after_sign',
      guards: 'signed contracts cannot be deleted',
    },
  ];

/**
 * Checks at boot that the database still enforces what the application believes it does.
 *
 * Added after a migration reported success while leaving a database without its
 * immutability triggers. Nothing failed — the service-level guards still refused edits,
 * the tests still passed against a freshly built test database, and the drift would have
 * gone unnoticed until someone reached the data another way. A guarantee that can quietly
 * disappear is not a guarantee, so the application now refuses to start without them.
 */
@Injectable()
export class DbIntegrityService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DbIntegrityService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async onApplicationBootstrap(): Promise<void> {
    const missing = await this.missingTriggers();
    if (missing.length === 0) {
      this.logger.log(`Database integrity: ${REQUIRED_TRIGGERS.length} guarantees present.`);
      return;
    }

    const detail = missing
      .map((t) => `  ${t.schema}.${t.table} → ${t.trigger} (${t.guards})`)
      .join('\n');
    throw new Error(
      `Database is missing ${missing.length} immutability trigger(s):\n${detail}\n\n` +
        'These are what make issued invoices, sent quotes, signed contracts and invoiced ' +
        'hours unalterable. Re-run the migrations against this database; if they report ' +
        'as already applied, apply the trigger statements from the relevant migration by hand.',
    );
  }

  /** Exposed so a test can assert the check itself works. */
  async missingTriggers(): Promise<typeof REQUIRED_TRIGGERS> {
    const rows = await this.db.execute(sql`
      SELECT n.nspname AS schema, c.relname AS "table", t.tgname AS trigger
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal
    `);
    const present = new Set(
      (rows.rows as Array<{ schema: string; table: string; trigger: string }>).map(
        (r) => `${r.schema}.${r.table}.${r.trigger}`,
      ),
    );
    return REQUIRED_TRIGGERS.filter(
      (t) => !present.has(`${t.schema}.${t.table}.${t.trigger}`),
    );
  }
}
