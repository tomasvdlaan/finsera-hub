export interface BoardColumn {
  key: string;
  label: string;
  isDone: boolean;
  /**
   * How many cards may sit here at once, if the column is limited.
   *
   * Advisory. Exceeding it warns rather than refuses — a board that will not accept reality
   * gets worked around instead of obeyed, and then it stops describing anything.
   */
  wipLimit?: number | null;
}

export interface Board {
  projectId: string;
  columns: BoardColumn[];
  usesSprints: boolean;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  assigneeId: string | null;
  estimateMinutes: number | null;
  /** Beside minutes, not instead of them. See the column comment in scrum.schema.ts. */
  storyPoints: number | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  /**
   * story | bug | chore | spike.
   *
   * The unit a retrospective is argued in. "Two fifths of this sprint went on unplanned bugs"
   * is a more useful sentence than any burndown line, and it cannot be said without this.
   */
  type: TaskType;
  sprintId: string | null;
  labels: string[];
  dueOn: string | null;
  parentId: string | null;
  completedAt: string | null;
  /**
   * Blocked, and why — beside the status rather than instead of it.
   *
   * A card is usually blocked while being somewhere: in progress waiting on a credential, in
   * review waiting on a sign-off. Both facts matter, so both are carried.
   */
  blockedReason: string | null;
  blockedSince: string | null;
  blockedOnUserId: string | null;

  /**
   * When this card last entered the column it is in, and how long ago that was in days.
   *
   * Derived server-side from the transition log rather than from `updatedAt`, which moves for
   * any edit — so a card whose title was corrected used to look freshly worked on, which is
   * exactly backwards for the card you most need to notice.
   */
  enteredColumnAt: string;
  daysInColumn: number;
  commentCount: number;
  /** The person, not the id — so a card can show a face without fetching the user list. */
  assignee: Person | null;
  /** A subtask is a task with a parent, so this is counted rather than stored. */
  subtasks: { done: number; total: number };
}

export interface Person {
  id: string;
  displayName: string;
}

/** A column change, for the trail on the preview. */
export interface Transition {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  at: string;
  movedBy: string;
  movedByName: string | null;
}

export const TASK_TYPES = ['story', 'bug', 'chore', 'spike'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/**
 * How long a card may sit before the board says so.
 *
 * Two thresholds rather than a gradient: a number that creeps up by shades is a number nobody
 * reads. Silent until it has been a working week, loud after two.
 */
export const ageTone = (days: number): 'stale' | 'old' | null =>
  days >= 14 ? 'old' : days >= 5 ? 'stale' : null;

export interface SprintProgress {
  /** Which of the three a screen should show. Decided server-side so every screen agrees. */
  unit: 'points' | 'minutes' | 'count';
  points: { done: number; total: number };
  minutes: { done: number; total: number };
  cards: { done: number; total: number };
  blocked: number;
  days: { elapsed: number; total: number; overrun: boolean };
}

/**
 * What a sprint turned out to be, frozen when it closed.
 *
 * Stored rather than derived because closing a sprint detaches everything unfinished — ask
 * the live tables what a completed sprint achieved and every one of them reports a clean
 * sweep. Null while a sprint is still open.
 */
export interface SprintSummary {
  unit: 'points' | 'minutes' | 'count';
  committed: { points: number; minutes: number; cards: number };
  completed: { points: number; minutes: number; cards: number };
  /** Completed cards by kind. The retrospective's one useful sentence. */
  byType: Record<string, number>;
  returnedToBacklog: number;
  days: { total: number; overran: boolean };
  closedAt: string;
}

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  startsOn: string;
  endsOn: string;
  state: 'planned' | 'active' | 'completed';
  progress: SprintProgress;
  summary: SprintSummary | null;
}

/** What a closed sprint delivered, in the unit it could honestly report at the time. */
export function deliveredLabel(s: SprintSummary): string {
  if (s.unit === 'points') return `${s.completed.points} of ${s.committed.points} pts`;
  if (s.unit === 'minutes') {
    const h = (m: number) => Math.round((m / 60) * 10) / 10;
    return `${h(s.completed.minutes)}h of ${h(s.committed.minutes)}h`;
  }
  return `${s.completed.cards} of ${s.committed.cards} cards`;
}

/** The delivered figure alone, for comparing one sprint against the next. */
export const deliveredValue = (s: SprintSummary): number =>
  s.unit === 'points'
    ? s.completed.points
    : s.unit === 'minutes'
      ? Math.round((s.completed.minutes / 60) * 10) / 10
      : s.completed.cards;

/**
 * How much of what it took on a sprint finished, as a fraction.
 *
 * Null when it took on nothing, because 0 of 0 renders as a full bar in every naive
 * percentage and an empty sprint did not succeed completely.
 */
export function deliveredFraction(s: SprintSummary): number | null {
  const { completed, committed } =
    s.unit === 'points'
      ? { completed: s.completed.points, committed: s.committed.points }
      : s.unit === 'minutes'
        ? { completed: s.completed.minutes, committed: s.committed.minutes }
        : { completed: s.completed.cards, committed: s.committed.cards };
  return committed > 0 ? Math.min(1, completed / committed) : null;
}

/**
 * How far through, as a fraction, in whatever unit the sprint can honestly report.
 *
 * Returns null rather than zero when there is nothing to measure. An empty sprint has done
 * 0 of 0, which every naive percentage renders as complete.
 */
export function sprintFraction(p: SprintProgress): number | null {
  const { done, total } =
    p.unit === 'points' ? p.points : p.unit === 'minutes' ? p.minutes : p.cards;
  return total > 0 ? Math.min(1, done / total) : null;
}

/** What the progress says, in words, naming its unit so nobody has to guess. */
export function sprintProgressLabel(p: SprintProgress): string {
  if (p.unit === 'points') return `${p.points.done} of ${p.points.total} pts`;
  if (p.unit === 'minutes') {
    const h = (m: number) => Math.round((m / 60) * 10) / 10;
    return `${h(p.minutes.done)}h of ${h(p.minutes.total)}h`;
  }
  return `${p.cards.done} of ${p.cards.total} cards`;
}

/** How long a card has been stuck, in whole days. */
export const daysBlocked = (blockedSince: string | null): number =>
  blockedSince ? Math.floor((Date.now() - new Date(blockedSince).getTime()) / 86_400_000) : 0;

export interface TaskDetail extends Task {
  children: Task[];
  loggedMinutes: number;
  history: Transition[];
}
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export const hours = (minutes: number | null | undefined): number | null =>
  minutes == null ? null : +(minutes / 60).toFixed(2);

/** Parse an hours input into whole minutes — the unit everything is stored in. */
export function toMinutes(input: string): number | null {
  const trimmed = input.trim().replace(',', '.');
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 60) : null;
}

/** Overdue is a fact about today, so it is computed rather than stored. */
export const isOverdue = (task: Task): boolean =>
  Boolean(task.dueOn && !task.completedAt && task.dueOn < new Date().toISOString().slice(0, 10));
