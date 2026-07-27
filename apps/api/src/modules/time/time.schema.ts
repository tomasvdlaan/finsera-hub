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
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The Time Registration module's schema (Phase 2 brief §3).
 *
 * Duration is WHOLE MINUTES, never decimal hours — same reasoning as money in cents:
 * 7.4 hours is not exactly representable in binary floating point, and these numbers
 * eventually multiply by a rate to produce an invoice. The UI accepts "7,5" or "7:30"
 * and converts at the edge.
 */
export const time = pgSchema('time');

export const entries = time.table(
  'entries',
  {
    id: uuid('id').primaryKey(), // same value as core.entities.id

    // Both required — a time entry with no person or no project cannot be invoiced,
    // reported on, or attributed. Stored as registry ids, validated in the service.
    personId: uuid('person_id').notNull(),
    projectId: uuid('project_id').notNull(),

    workedOn: date('worked_on').notNull(), // a day, not a moment
    minutes: integer('minutes').notNull(),
    billable: boolean('billable').notNull().default(true),
    description: text('description'), // optional on purpose — required notes kill adoption

    submittedAt: timestamp('submitted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The week view's only query shape.
    index('entries_person_date_idx').on(t.personId, t.workedOn),
    index('entries_project_idx').on(t.projectId),
    check('entries_minutes_positive', sql`${t.minutes} > 0`),
    // 24h in a day. A typo of 800 instead of 80 should not silently become a 13-hour day.
    check('entries_minutes_sane', sql`${t.minutes} <= 1440`),
  ],
);
