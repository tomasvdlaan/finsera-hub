import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Proactive insights (Phase 6).
 *
 * Everything else derived from today — `overdue`, `expired`, `expiringSoon` — is computed
 * on read and never stored, because nothing should change state while nobody is looking.
 * Insights are the deliberate exception, and only because they carry something a
 * computation cannot: whether YOU have already dealt with them. A dismissal is a fact
 * about a person, not about the data.
 *
 * Everything else about an insight is still derived. They are regenerated from the same
 * views each run, matched by `key`, and one whose condition has stopped being true
 * resolves itself rather than waiting to be dismissed.
 */
export const insights = pgSchema('insights');

export const INSIGHT_STATUSES = ['open', 'dismissed', 'resolved'] as const;
export const INSIGHT_SEVERITIES = ['info', 'attention', 'urgent'] as const;

export const insightRows = insights.table(
  'insights',
  {
    id: uuid('id').primaryKey(),

    /**
     * Stable natural key, `rule:subjectId`. Re-running the rules matches on this, so a
     * condition that is still true updates its insight instead of raising a second one.
     */
    key: text('key').notNull(),
    rule: text('rule').notNull(),

    /** What the insight is about — a registry id, so the UI can link to it. */
    subjectId: uuid('subject_id'),
    subjectType: text('subject_type'),

    severity: text('severity').notNull().default('attention'),
    status: text('status').notNull().default('open'),

    title: text('title').notNull(),
    detail: text('detail'),
    /** Numbers behind the sentence, so the UI need not re-query to show them. */
    facts: jsonb('facts').notNull().default({}),
    /** Sorting handle: euros at stake, days overdue — whatever the rule ranks by. */
    magnitude: bigint('magnitude', { mode: 'number' }).notNull().default(0),

    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedBy: uuid('dismissed_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('insights_key_unique').on(t.key),
    index('insights_status_idx').on(t.status),
    index('insights_subject_idx').on(t.subjectId),
    check('insights_status_valid', sql`${t.status} IN ('open','dismissed','resolved')`),
    check('insights_severity_valid', sql`${t.severity} IN ('info','attention','urgent')`),
    // Dismissed implies a dismissal timestamp — but not the converse. An insight that was
    // dismissed and later resolved itself keeps the record of having been dismissed;
    // that happened, and forgetting it would make the audit trail lie.
    check(
      'insights_dismissed_has_timestamp',
      sql`${t.status} <> 'dismissed' OR ${t.dismissedAt} IS NOT NULL`,
    ),
  ],
);
