import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Quotation (Phase 5a).
 *
 * A quote is a promise in writing, so it borrows invoicing's discipline: sent quotes are
 * frozen by trigger and their PDF is filed, because "which version did they agree to?"
 * must have an answer. It deliberately does NOT borrow invoicing's legal constraints —
 * quote numbers may have gaps, because no tax authority audits an abandoned draft.
 */
export const sales = pgSchema('sales');

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected'] as const;

/**
 * One counter row per year, locked FOR UPDATE when a quote is sent.
 *
 * Separate from the invoice counter on purpose: an abandoned quote must never disturb
 * the invoice sequence, which does have to be gapless.
 */
export const quoteCounters = sales.table('quote_counters', {
  year: integer('year').primaryKey(),
  lastNumber: integer('last_number').notNull().default(0),
});

export const quotes = sales.table(
  'quotes',
  {
    id: uuid('id').primaryKey(), // registry id

    /** Null while draft; allocated on send. Unique, so a bug fails loudly. */
    number: text('number'),
    status: text('status').notNull().default('draft'),

    clientId: uuid('client_id').notNull(), // registry id of a CRM client
    /** Set when this quote is for work on an existing project (a follow-on quote). */
    projectId: uuid('project_id'),

    title: text('title').notNull(),
    /** The scope, as the client reads it. Free text above the lines on the PDF. */
    introduction: text('introduction'),
    notes: text('notes'),

    /**
     * Revisions. A sent quote is immutable, so negotiating produces a NEW quote that
     * references the one it supersedes; version is that chain's depth.
     */
    supersedesQuoteId: uuid('supersedes_quote_id'),
    version: integer('version').notNull().default(1),

    currency: text('currency').notNull().default('EUR'),
    vatTreatment: text('vat_treatment').notNull(),

    /** Totals in integer cents, from the same VAT engine invoicing uses. */
    subtotalCents: bigint('subtotal_cents', { mode: 'number' }).notNull().default(0),
    vatCents: bigint('vat_cents', { mode: 'number' }).notNull().default(0),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull().default(0),

    /**
     * The hourly rate this quote is priced at, carried onto the project when accepted.
     * This is the number that makes the loop a loop — it stops the project rate being
     * retyped from memory, and lets an invoice be traced to what was agreed.
     */
    hourlyRateCents: bigint('hourly_rate_cents', { mode: 'number' }),
    billingModel: text('billing_model').notNull().default('time_and_materials'),

    issueDate: date('issue_date'),
    /** Expiry is DERIVED from this for display; nothing rewrites rows in the background. */
    validUntil: date('valid_until'),

    /** The PDF as sent, filed through Document Management. */
    pdfDocumentId: uuid('pdf_document_id'),
    /** The project accepting this quote created or attached to. */
    projectCreatedId: uuid('project_created_id'),

    createdBy: uuid('created_by').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('quotes_number_unique').on(t.number),
    index('quotes_client_idx').on(t.clientId),
    index('quotes_status_idx').on(t.status),
    index('quotes_supersedes_idx').on(t.supersedesQuoteId),
    check('quotes_status_valid', sql`${t.status} IN ('draft','sent','accepted','rejected')`),
    check(
      'quotes_vat_treatment_valid',
      sql`${t.vatTreatment} IN ('domestic_21','reverse_charge','outside_eu')`,
    ),
    check(
      'quotes_billing_model_valid',
      sql`${t.billingModel} IN ('time_and_materials','fixed_fee','retainer')`,
    ),
    // Sent means numbered and dated — the states cannot drift apart.
    check(
      'quotes_sent_is_complete',
      sql`(${t.sentAt} IS NULL) = (${t.number} IS NULL) AND ((${t.sentAt} IS NULL) = (${t.issueDate} IS NULL))`,
    ),
    // A decision can only follow a send: nothing is accepted before the client sees it.
    check('quotes_decided_needs_sent', sql`${t.decidedAt} IS NULL OR ${t.sentAt} IS NOT NULL`),
    check(
      'quotes_decided_matches_status',
      sql`(${t.decidedAt} IS NOT NULL) = (${t.status} IN ('accepted','rejected'))`,
    ),
    // A T&M quote without a rate cannot set the project rate, which is its whole job.
    check(
      'quotes_tm_needs_rate',
      sql`${t.billingModel} <> 'time_and_materials' OR ${t.sentAt} IS NULL OR ${t.hourlyRateCents} IS NOT NULL`,
    ),
  ],
);

export const quoteLines = sales.table(
  'quote_lines',
  {
    id: uuid('id').primaryKey(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(),
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    /** Percent, e.g. '21.00'. VAT is computed per RATE GROUP, not per line. */
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull(),
    /** 'hours' bills time; 'fixed' is a lump sum. Drives the unit shown on the PDF. */
    unit: text('unit').notNull().default('hours'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('quote_lines_quote_idx').on(t.quoteId),
    uniqueIndex('quote_lines_position').on(t.quoteId, t.position),
    check('quote_lines_unit_valid', sql`${t.unit} IN ('hours','fixed','days')`),
  ],
);
