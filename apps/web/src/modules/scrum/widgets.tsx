import { Link } from 'react-router-dom';
import { Card, Figure } from '../../shell/ui/card.js';
import { Donut, Legend, type Slice } from '../../shell/ui/viz.js';
import { Empty } from '../../shell/ui/primitives.js';
import { Skeleton } from '../../shell/ui/data.js';
import { useShared } from '../../lib/useShared.js';
import type { SettingDef, WidgetDef, WidgetProps } from '../types.js';

interface Task {
  id: string;
  projectId: string;
  title: string;
  status: string;
  flow: 'queue' | 'active' | 'waiting' | 'done';
  dueOn: string | null;
  assigneeId: string | null;
  daysInColumn: number;
}

/**
 * Whose work a widget is about.
 *
 * Offered on every board widget rather than fixed, because it is the single setting that most
 * changes what a dashboard is for: the same four counters read as "my day" or "the team's day"
 * depending only on this, and which one somebody wants is not something the code can know.
 *
 * Unassigned counts as mine. At two to four people an unowned card is not somebody else's, it
 * is nobody's — and nobody's is exactly what a front door should not hide.
 */
const SCOPE: SettingDef = {
  key: 'scope',
  label: 'Whose work',
  type: 'choice',
  options: [
    { value: 'mine', label: 'Mine and unassigned' },
    { value: 'everyone', label: 'Everyone' },
  ],
  default: 'mine',
};

/** The board, filtered by scope. Shared, so five widgets asking cost one request. */
function useBoard(scope: string | undefined) {
  const me = useShared<{ id: string }>('/core/me');
  const all = useShared<Task[]>('/scrum/tasks');
  const tasks = (all.data ?? []).filter(
    (t) => scope === 'everyone' || !me.data || t.assigneeId === me.data.id || t.assigneeId === null,
  );
  return { tasks, loading: all.loading, error: all.error };
}

/** A counter, which is four of the eight starter widgets and differs only in what it counts. */
function Counter({
  settings,
  label,
  pick,
  note,
  tone,
}: WidgetProps & {
  label: string;
  pick: (t: Task[]) => Task[];
  note: (found: Task[]) => string;
  tone?: (found: Task[]) => 'danger' | 'warning' | undefined;
}) {
  const { tasks, loading, error } = useBoard(settings.scope);
  const found = pick(tasks);
  if (error) return <Card><p className="error">{error}</p></Card>;
  return (
    <Card to="/work" tone={loading ? undefined : tone?.(found)}>
      {loading ? <Skeleton height="3rem" /> : <Figure label={label} value={found.length} note={note(found)} />}
    </Card>
  );
}

const active = (t: Task[]) => t.filter((x) => x.flow === 'active');
const waiting = (t: Task[]) => t.filter((x) => x.flow === 'waiting');
const today = () => new Date().toISOString().slice(0, 10);
const overdue = (t: Task[]) => t.filter((x) => x.dueOn && x.dueOn < today());
const oldest = (t: Task[]) => t.reduce((n, x) => Math.max(n, x.daysInColumn ?? 0), 0);

/** A list of cards, which is the other shape a board widget takes. */
function TaskList({ tasks, empty }: { tasks: Task[]; empty: string }) {
  if (tasks.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul>
      {tasks.map((t) => (
        <li key={t.id}>
          <Link to={`/tasks/${t.id}`}>{t.title}</Link>
          {t.daysInColumn > 0 && <span className="muted"> · {t.daysInColumn}d</span>}
        </li>
      ))}
    </ul>
  );
}

export const scrumWidgets: Record<string, WidgetDef> = {
  'scrum:in-progress': {
    title: 'In progress',
    description: 'How many cards are being worked on right now.',
    slot: 'dashboard',
    defaultSpan: 3,
    minSpan: 3,
    permission: 'scrum.tasks.read',
    settings: [SCOPE],
    Component: (p) => (
      <Counter
        {...p}
        label="In progress"
        pick={active}
        note={(f) =>
          f.length === 0
            ? 'nothing picked up'
            : `across ${new Set(f.map((t) => t.projectId)).size} ${new Set(f.map((t) => t.projectId)).size === 1 ? 'project' : 'projects'}`
        }
      />
    ),
  },

  'scrum:waiting-on-client': {
    title: 'Waiting on a client',
    description: 'Cards sitting with somebody outside the business, and how long the longest has been there.',
    slot: 'dashboard',
    defaultSpan: 3,
    minSpan: 3,
    permission: 'scrum.tasks.read',
    settings: [SCOPE],
    Component: (p) => (
      <Counter
        {...p}
        label="Waiting on a client"
        pick={waiting}
        note={(f) => (f.length === 0 ? 'nothing sitting with anyone' : `longest is ${oldest(f)} days`)}
        // Amber past a week only. A client taking two days is not a problem, and a tint that
        // appears for a normal thing stops meaning anything.
        tone={(f) => (oldest(f) >= 7 ? 'warning' : undefined)}
      />
    ),
  },

  'scrum:overdue': {
    title: 'Overdue',
    description: 'Cards past the date written on them.',
    slot: 'dashboard',
    defaultSpan: 3,
    minSpan: 3,
    permission: 'scrum.tasks.read',
    settings: [SCOPE],
    Component: (p) => (
      <Counter
        {...p}
        label="Overdue"
        pick={overdue}
        note={(f) => (f.length === 0 ? 'nothing past its date' : 'past the date on the card')}
        // Zero is good news and stays quiet: a clean board in the alarming colour looks exactly
        // as bad as a late one.
        tone={(f) => (f.length > 0 ? 'danger' : undefined)}
      />
    ),
  },

  'scrum:doing': {
    title: 'Doing',
    description: 'The cards in progress, by name.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'scrum.tasks.read',
    settings: [SCOPE],
    Component: ({ settings }) => {
      const { tasks, loading } = useBoard(settings.scope);
      return (
        <Card title="Doing" to="/work">
          {loading ? <Skeleton height="4rem" /> : <TaskList tasks={active(tasks)} empty="Nothing in progress." />}
        </Card>
      );
    },
  },

  'scrum:waiting-list': {
    title: 'Waiting on someone else',
    description: 'What is with a client, by name, with how long it has been there.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'scrum.tasks.read',
    settings: [SCOPE],
    Component: ({ settings }) => {
      const { tasks, loading } = useBoard(settings.scope);
      const rows = waiting(tasks);
      return (
        <Card
          title="Waiting on someone else"
          sub="Nothing here is yours to move — but a fortnight of silence is worth a nudge."
          tone={oldest(rows) >= 7 ? 'warning' : undefined}
          to="/work"
        >
          {loading ? <Skeleton height="4rem" /> : <TaskList tasks={rows} empty="Nothing is with a client." />}
        </Card>
      );
    },
  },

  'scrum:board-mix': {
    title: 'Board mix',
    description: 'How the cards are spread across done, doing, waiting and the queue.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'scrum.tasks.read',
    settings: [SCOPE],
    Component: ({ settings }) => {
      const { tasks, loading } = useBoard(settings.scope);
      const slices: Slice[] = [
        { label: 'Done', value: tasks.filter((t) => t.flow === 'done').length, tone: 'var(--ok)' },
        { label: 'To do', value: tasks.filter((t) => t.flow === 'queue').length, tone: 'var(--border-strong)' },
        { label: 'In progress', value: active(tasks).length, tone: 'var(--accent)' },
        { label: 'Waiting', value: waiting(tasks).length, tone: 'var(--warning)' },
      ];
      return (
        <Card title="Board mix" sub={`${tasks.length} cards`} to="/board">
          {loading ? (
            <Skeleton height="6rem" />
          ) : (
            <div className="widget-donut">
              <Donut slices={slices} total={tasks.length} />
              <Legend slices={slices} />
            </div>
          )}
        </Card>
      );
    },
  },

  /**
   * Contributed to CRM's project page.
   *
   * Declared in the manifest since the module was written and resolved by nothing — the project
   * page imported the component directly, which is why it has had to know that scrum, time,
   * docs and meetings all exist.
   */
  'scrum:open-tasks': {
    title: 'Open cards',
    description: "This project's unfinished work.",
    slot: 'entity-page',
    entityTypes: ['project'],
    defaultSpan: 6,
    permission: 'scrum.tasks.read',
    Component: ({ entityId }) => {
      const { data, loading } = useShared<Task[]>(entityId ? `/scrum/tasks?projectId=${entityId}` : null);
      return (
        <Card title="Open cards" to={entityId ? `/board?projectId=${entityId}` : undefined}>
          {loading ? <Skeleton height="4rem" /> : <TaskList tasks={data ?? []} empty="Nothing open on this project." />}
        </Card>
      );
    },
  },
};
