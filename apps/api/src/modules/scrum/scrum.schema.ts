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

/**
 * What a column *means*, as opposed to what it is called.
 *
 * A board could say a column was done and nothing else. That is enough to stamp `completed_at`
 * and no help at all for the two questions that matter about flow: when did work on this card
 * actually start, and is this column somewhere work happens or somewhere it queues. Cycle time
 * is "first entry into a working column until done", and a WIP limit on a backlog is a filing
 * rule rather than a limit — neither is expressible without this.
 *
 * It was already being guessed at, twice, in the web app, against column keys anyone is free to
 * rename in board settings: `Today.tsx` hardcoded `['in_progress','review']` as doing and
 * `['waiting_on_client']` as waiting, and `Work.tsx` kept its own canonical list with an "other"
 * lane for whatever fell out. Both silently mis-grouped a renamed column. This is the fact they
 * were both approximating, stored once where the columns are.
 *
 * `waiting` is separate from `active` rather than folded into it because the difference is the
 * whole reason "waiting on client" is a default column: it is time the work is not moving and
 * nobody here can move it. Counted as active it flatters the cycle time; counted as a queue it
 * disappears from it. It is neither.
 */
export type ColumnFlow = 'queue' | 'active' | 'waiting' | 'done';

export interface BoardColumn {
  key: string;
  label: string;
  /** Entering this column stamps completed_at — "done" is a property of the column. */
  isDone: boolean;
  /**
   * Where this column sits in the flow of work. Optional on the way in so an older board row
   * does not become invalid; defaulted on read, and validated on write.
   */
  flow?: ColumnFlow;
  /**
   * How many cards may sit here at once, if the column is limited.
   *
   * The one control that makes a board a system rather than a list. Without it a team — or
   * one person — starts everything and finishes nothing, and the board faithfully records
   * that as progress. It is advisory: exceeding it warns rather than refuses, because a
   * board that will not accept reality gets worked around instead of obeyed.
   */
  wipLimit?: number | null;
}

/**
 * Default columns.
 *
 * "Waiting on client" is a default rather than an option: in consultancy it is the state
 * work spends most time in and the one nobody records, so it silently reads as "in
 * progress" and the board lies about where things stand.
 */
export const DEFAULT_COLUMNS: BoardColumn[] = [
  { key: 'to_do', label: 'To do', isDone: false, flow: 'queue' },
  { key: 'in_progress', label: 'In progress', isDone: false, flow: 'active' },
  { key: 'waiting_on_client', label: 'Waiting on client', isDone: false, flow: 'waiting' },
  { key: 'review', label: 'Review', isDone: false, flow: 'active' },
  { key: 'done', label: 'Done', isDone: true, flow: 'done' },
];

export const COLUMN_FLOWS = ['queue', 'active', 'waiting', 'done'] as const;

/**
 * The flow of a column that does not declare one.
 *
 * Every board predates this field, so every board needs an answer that is right more often
 * than not. A done column is done; the first column of a board is where cards are created and
 * is therefore the queue; anything else is somewhere work happens. That last guess is the
 * generous one — it counts a column into cycle time rather than out of it, which errs toward
 * the unflattering number, which is the right direction to err.
 */
export const flowOf = (column: BoardColumn, index: number): ColumnFlow =>
  column.flow ?? (column.isDone ? 'done' : index === 0 ? 'queue' : 'active');

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

/**
 * What a sprint turned out to be, frozen at the moment it was closed.
 *
 * This has to be stored rather than derived, and the reason is the closing itself: finishing
 * a sprint sets `sprint_id = null` on everything unfinished, so afterwards the only cards
 * still pointing at it are the ones that got done. Ask the live tables what a completed
 * sprint achieved and every sprint ever run reports one hundred per cent — the evidence of
 * what was missed is destroyed by the act of finishing.
 *
 * `committed` is everything that was in it at the end; `completed` is the part that landed.
 * Both carry both units so a later screen can compare like with like, and `unit` records which
 * one the sprint could honestly report at the time — a backlog that was half-estimated then
 * does not become fully estimated later because somebody tidied up.
 *
 * `byType` counts only completed cards. It exists for the one sentence a retrospective
 * actually wants: two fifths of this went on bugs nobody planned.
 */
export interface SprintSummary {
  unit: 'minutes' | 'count';
  committed: { minutes: number; cards: number };
  completed: { minutes: number; cards: number };
  /** Completed cards by kind — story, bug, chore, spike. */
  byType: Record<string, number>;
  returnedToBacklog: number;
  days: { total: number; overran: boolean };
  closedAt: string;
}

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
    /** Written once, when the sprint is completed. Null for anything still open. */
    summary: jsonb('summary').$type<SprintSummary>(),
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
    /**
     * Minutes. Directly comparable to hours logged and to the project budget, which is why
     * this remains the estimate the money side of the platform reads.
     */
    estimateMinutes: integer('estimate_minutes'),
    /*
     * There was a `story_points` column here, and it is gone.
     *
     * It was added beside minutes with an explicit condition attached: "if a sprint or two goes
     * by with these never set, the honest move is to drop the column rather than keep a field
     * the UI has to apologise for." Eleven cards were created and not one was ever pointed,
     * while ten of the eleven carried an estimate — so the condition was met and the column
     * went. Minutes are the platform's one unit for effort, comparable against hours logged
     * and the project budget, which points never were.
     */
    priority: text('priority').notNull().default('normal'),
    /**
     * story | bug | chore | spike.
     *
     * Velocity that counts bug-fixing as delivered value is a lie, and a trustworthy
     * velocity is the main number a sprint is judged on. It also lets a retrospective be
     * told "two fifths of this sprint went on unplanned bugs", which is a far more useful
     * sentence than a burndown line.
     */
    type: text('type').notNull().default('story'),
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

/**
 * Every time a card changed column, and who moved it.
 *
 * Written for one question the board cannot otherwise answer: how long has this been sitting
 * here. `updatedAt` moves for any edit, so a card whose title was corrected looks freshly
 * worked on — which is exactly backwards for the card you most need to notice.
 *
 * Append-only by intent. It is the raw material for cycle time per column later, and a row
 * that can be edited is not evidence of anything.
 */
export const taskTransitions = scrum.table(
  'task_transitions',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    /** Null for the first row, which records the column a card was created in. */
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    movedBy: uuid('moved_by').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('task_transitions_task_idx').on(t.taskId, t.at)],
);
