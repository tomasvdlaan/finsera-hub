import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Contracts and rate cards (Phase 5b).
 *
 * Shares the `sales` schema with quotes: same commercial domain, same client seam, and a
 * contract is frequently what a quote turns into.
 */
export const salesContracts = pgSchema('sales');

/** A closed list: free text would calcify into inconsistent spellings (brief §3, D4). */
export const CONTRACT_TYPES = ['framework', 'sow', 'nda', 'dpa', 'other'] as const;
export const CONTRACT_STATUSES = ['draft', 'signed', 'terminated'] as const;

export const contracts = salesContracts.table(
  'contracts',
  {
    id: uuid('id').primaryKey(), // registry id

    clientId: uuid('client_id').notNull(),
    /** Set when this contract governs one specific engagement rather than the relationship. */
    projectId: uuid('project_id'),

    type: text('type').notNull(),
    status: text('status').notNull().default('draft'),
    title: text('title').notNull(),
    reference: text('reference'), // the client's own contract number, if they use one

    /**
     * The signed PDF, in Document Management. A registry id, not a copy — this platform
     * models "a file" once, and Documents already does it.
     */
    documentId: uuid('document_id'),

    startsOn: date('starts_on'),
    /** Null for an open-ended framework agreement. */
    endsOn: date('ends_on'),
    /**
     * Days of notice required to terminate. The notice WINDOW (are we inside it today?)
     * is derived on read — nothing changes state while nobody is looking.
     */
    noticeDays: integer('notice_days'),
    /** Rolls over automatically at end date unless notice is given. */
    autoRenews: text('auto_renews').notNull().default('no'),
    renewalMonths: integer('renewal_months'),

    /**
     * DPA-specific, because O8 needs an answer: does this DPA permit sub-processors?
     * AI providers are sub-processors, so this is the field that says whether the
     * assistant may touch a given client's data at all.
     */
    allowsSubProcessors: text('allows_sub_processors'),

    notes: text('notes'),

    createdBy: uuid('created_by').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contracts_client_idx').on(t.clientId),
    index('contracts_type_idx').on(t.type),
    index('contracts_ends_idx').on(t.endsOn),
    check('contracts_type_valid', sql`${t.type} IN ('framework','sow','nda','dpa','other')`),
    check('contracts_status_valid', sql`${t.status} IN ('draft','signed','terminated')`),
    check('contracts_auto_renews_valid', sql`${t.autoRenews} IN ('yes','no')`),
    check(
      'contracts_sub_processors_valid',
      sql`${t.allowsSubProcessors} IS NULL OR ${t.allowsSubProcessors} IN ('yes','no','unclear')`,
    ),
    check(
      'contracts_signed_is_complete',
      sql`(${t.signedAt} IS NULL) = (${t.status} <> 'signed' AND ${t.status} <> 'terminated')`,
    ),
    check('contracts_ends_after_starts', sql`${t.endsOn} IS NULL OR ${t.startsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`),
    // An auto-renewing contract without a period cannot say when it next renews.
    check(
      'contracts_renewal_needs_months',
      sql`${t.autoRenews} = 'no' OR ${t.renewalMonths} IS NOT NULL`,
    ),
  ],
);

/**
 * A named set of rates. `clientId` null is the house card — what Finsera charges by
 * default, before anyone negotiates.
 */
export const rateCards = salesContracts.table(
  'rate_cards',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id'),
    contractId: uuid('contract_id'),
    name: text('name').notNull(),
    currency: text('currency').notNull().default('EUR'),
    notes: text('notes'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('rate_cards_client_idx').on(t.clientId),
    index('rate_cards_contract_idx').on(t.contractId),
  ],
);

/**
 * One role at one price, from one date.
 *
 * Effective dates are recorded even though invoicing does not consult them (decision D1:
 * applying a rate is an explicit act, not an automatic one). They exist so an indexation
 * has a history, and so date-based lookup is a small change later rather than a rewrite —
 * `rateOn()` already implements the lookup and is tested.
 */
export const rateCardLines = salesContracts.table(
  'rate_card_lines',
  {
    id: uuid('id').primaryKey(),
    rateCardId: uuid('rate_card_id')
      .notNull()
      .references(() => rateCards.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'Consultant', 'Senior BI', …
    rateCents: bigint('rate_cents', { mode: 'number' }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('rate_card_lines_card_idx').on(t.rateCardId),
    // One rate per role per start date: two rows claiming the same day is a bug, not a choice.
    uniqueIndex('rate_card_lines_role_date').on(t.rateCardId, t.role, t.effectiveFrom),
    check('rate_card_lines_rate_positive', sql`${t.rateCents} > 0`),
  ],
);
