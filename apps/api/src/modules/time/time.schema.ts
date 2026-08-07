import { sql } from 'drizzle-orm';
import {
  boolean,
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
 * The Time Registration module's schema.
 *
 * Duration is WHOLE MINUTES, never decimal hours — same reasoning as money in cents:
 * 7.4 hours is not exactly representable in binary floating point, and these numbers
 * eventually multiply by a rate to produce an invoice.
 *
 * An entry may be expressed three ways:
 *   1. a bare duration        — minutes, no clock times (logging yesterday from memory)
 *   2. a finished session     — startedAt + endedAt, minutes derived on save
 *   3. a RUNNING session      — startedAt with no endedAt, minutes still null
 *
 * (3) is why there is no separate timer table or timer state: a running timer is simply
 * an entry that has not ended yet. One less thing to keep in sync.
 */
export const time = pgSchema('time');

export const entries = time.table(
  'entries',
  {
    id: uuid('id').primaryKey(), // same value as core.entities.id

    personId: uuid('person_id').notNull(),
    /**
     * What these hours are against — a project, a client, or neither.
     *
     * Both were once required, which forced every hour to belong to a billable project of a
     * paying customer. The visible consequence was Finsera registering itself as its own
     * client and opening a time-and-materials project called "Dashboard" to log building
     * this platform against: a fake customer and a fake sale, in the pipeline and the burn
     * reports, because there was nowhere else for the time to go.
     *
     * Three shapes now, and at most one of these two is ever set (see the check below):
     *   projectId  — work on a project. The only shape `draftFromHours` can invoice.
     *   clientId   — work for a client with no project yet: scoping, pre-sales, account care.
     *   neither    — internal. Admin, bookkeeping, our own product.
     *
     * Registry ids rather than foreign keys, for the reason `taskId` gives below: Time may
     * not depend on CRM. Both are validated through the registry.
     */
    projectId: uuid('project_id'),
    clientId: uuid('client_id'),
    /**
     * Optional task these hours belong to.
     *
     * A registry id, not a foreign key (Master §10): a cross-schema FK would make Time
     * depend on SCRUM while SCRUM depends on Time for timers — a cycle, with neither
     * module replaceable. Validated through the registry instead.
     */
    taskId: uuid('task_id'),

    workedOn: date('worked_on').notNull(), // the day this belongs to
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    minutes: integer('minutes'), // null while running

    /**
     * Defaults to false now.
     *
     * It defaulted to true, which was right when every hour belonged to a customer project
     * and is wrong the moment internal work can be recorded: an admin afternoon that arrives
     * pre-marked billable overstates what can actually be invoiced, and the figure it inflates
     * is the one the business is run on. The tracker sets it explicitly when there is a
     * project, which is the case where "billable" is a safe guess.
     */
    billable: boolean('billable').notNull().default(false),
    description: text('description'), // optional on purpose — required notes kill adoption

    /**
     * Which invoice claims these hours, and whether that invoice has been issued.
     *
     * This is THE answer to "have these hours been billed?" — deliberately here rather
     * than derived from invoice lines, because Time may not import Billing (that would
     * cycle: Billing already imports Time). Billing writes these columns inside the same
     * transaction that writes the lines, so the two can never disagree.
     *
     *   invoiceId null                   → not on any invoice
     *   invoiceId set, invoicedAt null   → on a draft, still editable
     *   invoicedAt set                   → invoiced for real; the invoice is immutable
     *
     * A registry id, not a foreign key — same reasoning as taskId above.
     */
    invoiceId: uuid('invoice_id'),
    invoicedAt: timestamp('invoiced_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('entries_person_date_idx').on(t.personId, t.workedOn),
    index('entries_project_idx').on(t.projectId),
    index('entries_task_idx').on(t.taskId),
    index('entries_invoice_idx').on(t.invoiceId),

    // Only one clock can be running per person; two would make "stop the timer"
    // ambiguous and quietly double-count the overlap.
    uniqueIndex('entries_one_running_per_person')
      .on(t.personId)
      .where(sql`${t.startedAt} IS NOT NULL AND ${t.endedAt} IS NULL`),

    /*
     * A project or a client, never both.
     *
     * The client of a project is the project's own business, so storing it twice would let
     * an hour claim to be on Acme's project and for Vandenberg — and the pair would drift
     * the first time a project moved. Internal work sets neither.
     */
    check(
      'entries_one_target',
      sql`${t.projectId} IS NULL OR ${t.clientId} IS NULL`,
    ),
    /*
     * Only hours with somewhere to send them can be billable.
     *
     * The database enforces this rather than the service, because it is the invariant the
     * revenue figures rest on: an unattributed hour marked billable is an hour the business
     * believes it can invoice and cannot.
     */
    check(
      'entries_billable_needs_target',
      sql`${t.billable} = false OR ${t.projectId} IS NOT NULL OR ${t.clientId} IS NOT NULL`,
    ),
    check('entries_minutes_positive', sql`${t.minutes} IS NULL OR ${t.minutes} > 0`),
    check('entries_minutes_sane', sql`${t.minutes} IS NULL OR ${t.minutes} <= 1440`),

    // An end without a start is meaningless.
    check('entries_end_needs_start', sql`${t.endedAt} IS NULL OR ${t.startedAt} IS NOT NULL`),
    // Invoiced means invoiced BY something: the stamp cannot float free of its invoice.
    check(
      'entries_invoiced_needs_invoice',
      sql`${t.invoicedAt} IS NULL OR ${t.invoiceId} IS NOT NULL`,
    ),
    check('entries_end_after_start', sql`${t.endedAt} IS NULL OR ${t.endedAt} > ${t.startedAt}`),

    // Every entry is either measurable (has minutes) or currently running. Without this
    // an entry could exist with no duration and no clock — billable for nothing.
    check(
      'entries_measurable_or_running',
      sql`${t.minutes} IS NOT NULL OR (${t.startedAt} IS NOT NULL AND ${t.endedAt} IS NULL)`,
    ),
  ],
);

/**
 * A person's week, and whether anybody has looked at it.
 *
 * This overturns a decision written into billing.service.ts — *"there is no submission step:
 * a logged hour with a duration is a billable hour, and the draft is where the work gets
 * reviewed"*. That reasoning is correct for one person and stops being correct at two: whoever
 * assembles the invoice can review their own hours from memory, and cannot tell whether
 * somebody else's four-hour entry was finished work or a mid-thought they meant to split.
 *
 * Deliberately additive. A week nobody has submitted behaves exactly as it always did, so
 * turning this on breaks nothing and changes no existing number — see `blockedWeeks` in the
 * service for what actually holds an hour back. Submitting is a *stronger* claim about a week,
 * not a new obstacle in front of it.
 *
 * One row per person per week, keyed on the Monday. There is no row until something happens,
 * so "open" is the absence of a row rather than a state anybody has to write.
 */
export const timesheets = time.table(
  'timesheets',
  {
    id: uuid('id').primaryKey(),
    personId: uuid('person_id').notNull(),
    /** The Monday. Every week in this system starts on one; see weekStart(). */
    weekOf: date('week_of').notNull(),
    /**
     * `submitted` — the person says it is ready and it is waiting on somebody.
     * `approved`  — somebody has agreed, and the hours may be invoiced.
     * `returned`  — somebody has sent it back, with a reason, and it may not.
     */
    status: text('status').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /**
     * Who decided, recorded even when it is the same person who submitted.
     *
     * At this size self-approval has to work or the feature is unusable, so the control is the
     * permission rather than the identity — and the identity is kept so that "who approved
     * this" is answerable later, which is the whole point of an approval.
     */
    decidedBy: uuid('decided_by'),
    /** Why it was sent back. Required for `returned` — see the check below. */
    note: text('note'),
  },
  (t) => [
    uniqueIndex('timesheets_person_week').on(t.personId, t.weekOf),
    index('timesheets_status').on(t.status),
    check('timesheets_status_known', sql`${t.status} IN ('submitted','approved','returned')`),
    /*
     * Sending a week back without saying why is the same as not sending it back: the person
     * gets a red badge and no idea what to change. The database refuses it rather than
     * relying on every caller to remember.
     */
    check(
      'timesheets_returned_needs_reason',
      sql`${t.status} <> 'returned' OR (${t.note} IS NOT NULL AND length(btrim(${t.note})) > 0)`,
    ),
  ],
);
