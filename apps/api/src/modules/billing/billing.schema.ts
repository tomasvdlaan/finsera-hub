import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Invoicing (Phase 5c).
 *
 * The rules here are legal, not stylistic: sequential numbers without gaps, no editing
 * after issue, VAT computed per rate. Where possible they live in the database — the
 * migration adds a trigger making issued invoices immutable, because "the UI hides the
 * edit button" is not a guarantee.
 */
export const billing = pgSchema('billing');

export const INVOICE_KINDS = ['invoice', 'credit_note'] as const;
/** `overdue` is a fact about today, so it is computed from due_on rather than stored. */
export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void'] as const;

/**
 * One counter row per year, locked FOR UPDATE inside the issuing transaction. Numbers
 * are allocated at ISSUE, never at draft — a deleted draft must not leave a gap.
 */
export const invoiceCounters = billing.table('invoice_counters', {
  year: integer('year').primaryKey(),
  lastNumber: integer('last_number').notNull().default(0),
});

export const invoices = billing.table(
  'invoices',
  {
    id: uuid('id').primaryKey(), // registry id
    kind: text('kind').notNull().default('invoice'),
    /** Null while draft; allocated at issue. Unique, so a bug fails loudly. */
    number: text('number'),
    status: text('status').notNull().default('draft'),

    clientId: uuid('client_id').notNull(), // registry id of a CRM client
    projectId: uuid('project_id'), //         optional; an invoice may span none or one

    /** Credit notes reference the invoice they reverse. */
    creditsInvoiceId: uuid('credits_invoice_id'),

    currency: text('currency').notNull().default('EUR'),
    vatTreatment: text('vat_treatment').notNull(),
    /** Snapshotted at issue: the client's VAT number as printed. */
    clientVatNumber: text('client_vat_number'),

    /** Totals in integer cents, computed by the VAT engine, frozen at issue. */
    subtotalCents: bigint('subtotal_cents', { mode: 'number' }).notNull().default(0),
    vatCents: bigint('vat_cents', { mode: 'number' }).notNull().default(0),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull().default(0),

    issueDate: date('issue_date'),
    dueOn: date('due_on'),
    notes: text('notes'),

    /** The PDF as sent, stored through Document Management at issue time. */
    pdfDocumentId: uuid('pdf_document_id'),

    createdBy: uuid('created_by').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invoices_number_unique').on(t.number),
    index('invoices_client_idx').on(t.clientId),
    index('invoices_status_idx').on(t.status),
    check('invoices_kind_valid', sql`${t.kind} IN ('invoice','credit_note')`),
    check('invoices_status_valid', sql`${t.status} IN ('draft','issued','paid','void')`),
    check(
      'invoices_vat_treatment_valid',
      sql`${t.vatTreatment} IN ('domestic_21','reverse_charge','outside_eu')`,
    ),
    // Issued means numbered and dated — the states cannot drift apart.
    check(
      'invoices_issued_is_complete',
      sql`(${t.issuedAt} IS NULL) = (${t.number} IS NULL) AND ((${t.issuedAt} IS NULL) = (${t.issueDate} IS NULL))`,
    ),
    // Reverse charge without the client's VAT number is not a valid invoice (brief §4).
    check(
      'invoices_reverse_charge_needs_vat',
      sql`${t.vatTreatment} <> 'reverse_charge' OR ${t.issuedAt} IS NULL OR ${t.clientVatNumber} IS NOT NULL`,
    ),
    check(
      'invoices_credit_note_references',
      sql`${t.kind} <> 'credit_note' OR ${t.creditsInvoiceId} IS NOT NULL`,
    ),
  ],
);

export const invoiceLines = billing.table(
  'invoice_lines',
  {
    id: uuid('id').primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    /** Hours for T&M lines; 1 for fixed amounts. Numeric, exact. */
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(),
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    /** quantity × unit price, rounded half-up once, here. */
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    /** Percent, e.g. '21.00'. VAT is computed per RATE GROUP, not per line (brief §4). */
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull(),
    /** Which time entries this line bills, so an hour can never be billed twice. */
    sourceEntryIds: jsonb('source_entry_ids').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invoice_lines_invoice_idx').on(t.invoiceId),
    uniqueIndex('invoice_lines_position').on(t.invoiceId, t.position),
  ],
);
