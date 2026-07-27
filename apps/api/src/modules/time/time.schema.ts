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
    projectId: uuid('project_id').notNull(),
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

    billable: boolean('billable').notNull().default(true),
    description: text('description'), // optional on purpose — required notes kill adoption

    submittedAt: timestamp('submitted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('entries_person_date_idx').on(t.personId, t.workedOn),
    index('entries_project_idx').on(t.projectId),
    index('entries_task_idx').on(t.taskId),

    // Only one clock can be running per person; two would make "stop the timer"
    // ambiguous and quietly double-count the overlap.
    uniqueIndex('entries_one_running_per_person')
      .on(t.personId)
      .where(sql`${t.startedAt} IS NOT NULL AND ${t.endedAt} IS NULL`),

    check('entries_minutes_positive', sql`${t.minutes} IS NULL OR ${t.minutes} > 0`),
    check('entries_minutes_sane', sql`${t.minutes} IS NULL OR ${t.minutes} <= 1440`),

    // An end without a start is meaningless.
    check('entries_end_needs_start', sql`${t.endedAt} IS NULL OR ${t.startedAt} IS NOT NULL`),
    check('entries_end_after_start', sql`${t.endedAt} IS NULL OR ${t.endedAt} > ${t.startedAt}`),

    // Every entry is either measurable (has minutes) or currently running. Without this
    // an entry could exist with no duration and no clock — billable for nothing.
    check(
      'entries_measurable_or_running',
      sql`${t.minutes} IS NOT NULL OR (${t.startedAt} IS NOT NULL AND ${t.endedAt} IS NULL)`,
    ),
  ],
);
