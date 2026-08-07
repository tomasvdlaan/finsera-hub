import { Link } from 'react-router-dom';
import { Card, Figure } from '../../shell/ui/card.js';
import { Donut, Legend, Scatter, Bullet, Heatmap, type Slice } from '../../shell/ui/viz.js';
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

interface Sample {
  taskId: string;
  title: string;
  minutes: number;
}

interface Flow {
  cards: number;
  reopened: number;
  cycle: { n: number; meaningful: boolean; p50: number | null; p85: number | null; samples: Sample[] };
  aging: Array<{ taskId: string; title: string; minutes: number; waiting: boolean; measured: boolean }>;
  waiting: { minutes: number; spells: number; now: number };
  throughput: Array<{ week: string; count: number }>;
}

/** Which board a widget is looking at. Every flow widget needs one and none can guess. */
const PROJECT: SettingDef = { key: 'projectId', label: 'Project', type: 'project' };

const dur = (m: number) => (m < 60 ? `${Math.round(m)}m` : m < 2880 ? `${Math.round(m / 6) / 10}h` : `${Math.round(m / 144) / 10}d`);

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

  /* ── The development team ─────────────────────────────────────────────── */

  'scrum:cycle-scatter': {
    title: 'How long cards actually take',
    description: 'Every finished card as a dot. A median says four days; this says whether that is fifteen four-day cards or thirteen quick ones and two disasters.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 6,
    permission: 'scrum.tasks.read',
    settings: [PROJECT],
    Component: ({ settings }) => {
      const { data, loading } = useShared<Flow>(
        settings.projectId ? `/scrum/projects/${settings.projectId}/flow` : null,
      );
      const samples = data?.cycle.samples ?? [];
      if (!settings.projectId) {
        return (
          <Card title="How long cards actually take">
            <Empty>Pick a project in this widget&rsquo;s settings.</Empty>
          </Card>
        );
      }
      return (
        <Card
          title="How long cards actually take"
          sub={data ? `${data.cycle.n} finished · dots above the line took longer than most` : undefined}
          to={`/board/flow?projectId=${settings.projectId}`}
        >
          {loading ? (
            <Skeleton height="6rem" />
          ) : (
            <Scatter
              // Ordered by finish rather than plotted against a real date axis: the API returns
              // durations without timestamps, and inventing an x position from an index is
              // honest as "these in this order" and would be a lie as "these on these days".
              points={samples.map((sp, i) => ({ x: i, y: sp.minutes, label: sp.title }))}
              band={
                data?.cycle.meaningful && data.cycle.p85 !== null
                  ? { value: data.cycle.p85, label: `p85 ${dur(data.cycle.p85)}` }
                  : undefined
              }
              yLabel={dur}
            />
          )}
        </Card>
      );
    },
  },

  'scrum:aging-wip': {
    title: 'What is going stale',
    description: 'Every unfinished card, oldest first, measured against how long finished ones took.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'scrum.tasks.read',
    settings: [PROJECT],
    Component: ({ settings }) => {
      const { data, loading } = useShared<Flow>(
        settings.projectId ? `/scrum/projects/${settings.projectId}/flow` : null,
      );
      const p85 = data?.cycle.meaningful ? data.cycle.p85 : null;
      const rows = (data?.aging ?? [])
        .slice()
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 6)
        .map((a) => ({ label: a.title, value: a.minutes, of: p85 }));
      return (
        <Card
          title="What is going stale"
          sub={p85 ? `against p85 of ${dur(p85)}` : 'no baseline yet — too few finished cards'}
          to={settings.projectId ? `/board/flow?projectId=${settings.projectId}` : undefined}
        >
          {loading ? <Skeleton height="5rem" /> : <Bullet rows={rows} format={dur} />}
        </Card>
      );
    },
  },

  'scrum:came-back': {
    title: 'Work that came back',
    description: 'Cards finished and then reopened. The number a "done" column cannot show you.',
    slot: 'dashboard',
    defaultSpan: 3,
    minSpan: 3,
    permission: 'scrum.tasks.read',
    settings: [PROJECT],
    Component: ({ settings }) => {
      const { data, loading } = useShared<Flow>(
        settings.projectId ? `/scrum/projects/${settings.projectId}/flow` : null,
      );
      const n = data?.reopened ?? 0;
      return (
        <Card tone={n > 0 ? 'warning' : undefined} to={settings.projectId ? `/board/flow?projectId=${settings.projectId}` : undefined}>
          {loading ? (
            <Skeleton height="3rem" />
          ) : (
            <Figure
              label="Came back"
              value={n}
              unit={n === 1 ? 'card' : 'cards'}
              note={n === 0 ? 'nothing has been reopened' : 'finished, then reopened'}
            />
          )}
        </Card>
      );
    },
  },

  'scrum:throughput-heat': {
    title: 'Delivery rhythm',
    description: 'Cards finished per week as a grid, so a good fortnight and a stalled one are the same glance.',
    slot: 'dashboard',
    defaultSpan: 4,
    minSpan: 3,
    permission: 'scrum.tasks.read',
    settings: [PROJECT],
    Component: ({ settings }) => {
      const { data, loading } = useShared<Flow>(
        settings.projectId ? `/scrum/projects/${settings.projectId}/flow` : null,
      );
      const weeks = data?.throughput ?? [];
      const total = weeks.reduce((n, w) => n + w.count, 0);
      return (
        <Card
          title="Delivery rhythm"
          sub={loading ? undefined : `${total} finished over ${weeks.length} weeks`}
          to={settings.projectId ? `/board/flow?projectId=${settings.projectId}` : undefined}
        >
          {loading ? (
            <Skeleton height="4rem" />
          ) : (
            <div className="card-fill">
              <Heatmap
                cells={weeks.map((w) => ({ date: w.week, value: w.count }))}
                weeks={Math.max(1, Math.ceil(weeks.length / 7))}
                format={(n) => `${n} finished`}
              />
            </div>
          )}
        </Card>
      );
    },
  },
};
