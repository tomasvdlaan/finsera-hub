import { sql } from 'drizzle-orm';
import {
  boolean,
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

export const scrum = pgSchema('scrum');

export interface BoardColumn {
  key: string;
  label: string;
  /** Entering this column stamps completed_at — "done" is a property of the column. */
  isDone: boolean;
}

/**
 * Default columns.
 *
 * "Waiting on client" is a default rather than an option: in consultancy it is the state
 * work spends most time in and the one nobody records, so it silently reads as "in
 * progress" and the board lies about where things stand.
 */
export const DEFAULT_COLUMNS: BoardColumn[] = [
  { key: 'to_do', label: 'To do', isDone: false },
  { key: 'in_progress', label: 'In progress', isDone: false },
  { key: 'waiting_on_client', label: 'Waiting on client', isDone: false },
  { key: 'review', label: 'Review', isDone: false },
  { key: 'done', label: 'Done', isDone: true },
];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const SPRINT_STATES = ['planned', 'active', 'completed'] as const;

/** One board per project: how a project is worked, owned here rather than by CRM. */
export const boards = scrum.table('boards', {
  projectId: uuid('project_id').primaryKey(), // registry id of a CRM project
  columns: jsonb('columns').$type<BoardColumn[]>().notNull().default(DEFAULT_COLUMNS),
  usesSprints: boolean('uses_sprints').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sprints = scrum.table(
  'sprints',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    name: text('name').notNull(),
    goal: text('goal'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    state: text('state').notNull().default('planned'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sprints_project_idx').on(t.projectId),
    // "The current sprint" becomes meaningless the moment two are open, and every later
    // query inherits that ambiguity — so it is enforced here, not in the UI.
    uniqueIndex('sprints_one_active_per_project')
      .on(t.projectId)
      .where(sql`${t.state} = 'active'`),
    check('sprints_state_valid', sql`${t.state} IN ('planned','active','completed')`),
    check('sprints_dates_ordered', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

export const tasks = scrum.table(
  'tasks',
  {
    id: uuid('id').primaryKey(), // registry id
    projectId: uuid('project_id').notNull(), // registry id of a CRM project
    title: text('title').notNull(),
    description: text('description'),
    /** The board column this sits in; validated against the project's board in the service. */
    status: text('status').notNull().default('to_do'),
    assigneeId: uuid('assignee_id'), // core.users id, no cross-schema FK
    /** Minutes, not story points — comparable to hours logged and to the project budget. */
    estimateMinutes: integer('estimate_minutes'),
    priority: text('priority').notNull().default('normal'),
    labels: text('labels').array().notNull().default(sql`ARRAY[]::text[]`),
    dueOn: date('due_on'),
    /** An epic is a task with children, not a separate entity. */
    parentId: uuid('parent_id'),
    sprintId: uuid('sprint_id').references(() => sprints.id, { onDelete: 'set null' }),
    /** Fractional so moving a card writes one row, not the whole column. */
    rank: numeric('rank', { precision: 20, scale: 10 }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    /**
     * Blocked, and why.
     *
     * Orthogonal to `status` rather than a column on the board, because a card is normally
     * blocked *while* being somewhere: in progress and waiting on a credential, in review and
     * waiting on a sign-off. A "blocked" column would force it to stop being where it is to
     * say it is stuck, and would lose the more useful fact of the two.
     *
     * `waiting_on_client` stays exactly as it is. That is about the client specifically and it
     * earned its place; this is the internal case — a dependency, a person, a decision — which
     * had nowhere to live at all. Where they coincide, both are true.
     *
     * The reason is not optional. "Blocked" with no reason is a red badge nobody can act on,
     * and by the time anyone asks, the answer has been forgotten.
     */
    blockedReason: text('blocked_reason'),
    blockedSince: timestamp('blocked_since', { withTimezone: true }),
    /** Who we are waiting on, when it is a person. A core.users id, no cross-schema FK. */
    blockedOnUserId: uuid('blocked_on_user_id'),

    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('tasks_project_status_idx').on(t.projectId, t.status),
    index('tasks_sprint_idx').on(t.sprintId),
    index('tasks_parent_idx').on(t.parentId),
    index('tasks_assignee_idx').on(t.assigneeId),
    check('tasks_priority_valid', sql`${t.priority} IN ('low','normal','high','urgent')`),
    check(
      'tasks_estimate_sane',
      sql`${t.estimateMinutes} IS NULL OR (${t.estimateMinutes} > 0 AND ${t.estimateMinutes} <= 100000)`,
    ),
    // A task cannot be its own parent; deeper cycles are checked in the service.
    check('tasks_not_own_parent', sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
    // Blocked means blocked for a reason since a moment. Neither half is meaningful alone:
    // a reason with no start cannot age, and a start with no reason cannot be acted on.
    check(
      'tasks_blocked_is_complete',
      sql`(${t.blockedReason} IS NULL) = (${t.blockedSince} IS NULL)`,
    ),
    index('tasks_blocked_idx').on(t.blockedSince),
  ],
);
