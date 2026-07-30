export interface BoardColumn {
  key: string;
  label: string;
  isDone: boolean;
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
}

export interface SprintProgress {
  /** Which of the three a screen should show. Decided server-side so every screen agrees. */
  unit: 'points' | 'minutes' | 'count';
  points: { done: number; total: number };
  minutes: { done: number; total: number };
  cards: { done: number; total: number };
  blocked: number;
  days: { elapsed: number; total: number; overrun: boolean };
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
  assignee: { id: string; displayName: string } | null;
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
