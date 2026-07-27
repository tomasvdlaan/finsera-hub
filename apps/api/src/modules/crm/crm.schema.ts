import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The CRM module's schema (Phase 1 brief §3) — the master-data spine.
 *
 * Money is INTEGER CENTS, never floating point: binary floats cannot represent 0.10
 * exactly, and this data eventually produces invoices.
 *
 * `owner_id` holds a core.users id but carries no cross-schema foreign key, matching the
 * architecture's droppability rule (Master §10) — validated in the service instead.
 */
export const crm = pgSchema('crm');

export const CLIENT_STATUSES = ['lead', 'proposal', 'active', 'dormant', 'lost'] as const;
export const PROJECT_STATUSES = [
  'prospective',
  'active',
  'on_hold',
  'completed',
  'cancelled',
] as const;
export const BILLING_MODELS = ['time_and_materials', 'fixed_fee', 'retainer'] as const;
export const RETAINER_PERIODS = ['monthly', 'quarterly', 'annual'] as const;

/** A prospect and a customer are the same record at different stages (brief §3.1). */
export const clients = crm.table(
  'clients',
  {
    id: uuid('id').primaryKey(), // same value as core.entities.id
    name: text('name').notNull(),
    status: text('status').notNull().default('lead'),
    ownerId: uuid('owner_id'), // core.users id; no cross-schema FK by design
    website: text('website'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('clients_status_idx').on(t.status),
    check('clients_status_valid', sql`${t.status} IN ('lead','proposal','active','dormant','lost')`),
  ],
);

export const contacts = crm.table(
  'contacts',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id), // structural, within this module's schema
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    role: text('role'), // free text — enumerating job titles never survives reality
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('contacts_client_idx').on(t.clientId),
    // At most one primary per client, and archived contacts do not hold the slot.
    uniqueIndex('contacts_one_primary_per_client')
      .on(t.clientId)
      .where(sql`${t.isPrimary} AND ${t.archivedAt} IS NULL`),
  ],
);

/**
 * The entity most other modules attach to. Billing-model-specific fields are nullable
 * columns on one table rather than three tables: invoicing (Phase 5c) must read a budget
 * without knowing which shape it is. CHECK constraints keep the combinations honest.
 */
export const projects = crm.table(
  'projects',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    status: text('status').notNull().default('prospective'),
    ownerId: uuid('owner_id'),
    currency: text('currency').notNull().default('EUR'),

    billingModel: text('billing_model').notNull(),
    defaultRateCents: bigint('default_rate_cents', { mode: 'number' }),
    budgetAmountCents: bigint('budget_amount_cents', { mode: 'number' }),
    budgetHours: numeric('budget_hours', { precision: 10, scale: 2 }),
    retainerAmountCents: bigint('retainer_amount_cents', { mode: 'number' }),
    retainerPeriod: text('retainer_period'),

    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('projects_client_idx').on(t.clientId),
    index('projects_status_idx').on(t.status),
    check(
      'projects_status_valid',
      sql`${t.status} IN ('prospective','active','on_hold','completed','cancelled')`,
    ),
    check(
      'projects_billing_model_valid',
      sql`${t.billingModel} IN ('time_and_materials','fixed_fee','retainer')`,
    ),
    check(
      'projects_retainer_period_valid',
      sql`${t.retainerPeriod} IS NULL OR ${t.retainerPeriod} IN ('monthly','quarterly','annual')`,
    ),
    // A fixed-fee project without a price, or a retainer without an amount and period,
    // is incomplete data that invoicing would later have to guess at.
    check(
      'projects_fixed_fee_has_amount',
      sql`${t.billingModel} <> 'fixed_fee' OR ${t.budgetAmountCents} IS NOT NULL`,
    ),
    check(
      'projects_retainer_has_terms',
      sql`${t.billingModel} <> 'retainer' OR (${t.retainerAmountCents} IS NOT NULL AND ${t.retainerPeriod} IS NOT NULL)`,
    ),
    check('projects_dates_ordered', sql`${t.endsOn} IS NULL OR ${t.startsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`),
    check('projects_amounts_non_negative', sql`
      (${t.defaultRateCents} IS NULL OR ${t.defaultRateCents} >= 0) AND
      (${t.budgetAmountCents} IS NULL OR ${t.budgetAmountCents} >= 0) AND
      (${t.retainerAmountCents} IS NULL OR ${t.retainerAmountCents} >= 0)
    `),
  ],
);
