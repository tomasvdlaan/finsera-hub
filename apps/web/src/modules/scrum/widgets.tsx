import { Link } from 'react-router-dom';
import { Card, Figure } from '../../shell/ui/card.js';
import { Donut, Legend, Scatter, Bullet, Heatmap, type Slice } from '../../shell/ui/viz.js';
import { Empty } from '../../shell/ui/primitives.js';
import { Skeleton } from '../../shell/ui/data.js';
import { useShared } from '../../lib/useShared.js';
import { api } from '../../lib/api.js';
import { Act } from '../../shell/ui/act.js';
import type { SettingDef, WidgetDef, WidgetProps } from '../types.js';

interface Task {
  id: string;
  projectId: string;
  title: string;
  status: string;
  estimateMinutes: number | null;
  blockedReason: string | null;
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

/** Just the fields this file reads, matching what the board endpoint returns. */
interface BoardColumn {
  key: string;
  label: string;
  flow?: 'queue' | 'active' | 'waiting' | 'done';
}

interface Sprint {
  id: string;
  name: string;
  progress?: {
    unit: 'minutes' | 'count';
    minutes: { done: number; total: number };
    cards: { done: number; total: number };
    days: { elapsed: number; total: number; overrun: boolean };
  };
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

  'scrum:my-board': {
    title: 'My board',
    description: 'One board at a glance: what is in each column, what is stuck on you, and how the sprint is going.',
    slot: 'dashboard',
    defaultSpan: 8,
    minSpan: 6,
    permission: 'scrum.tasks.read',
    settings: [SCOPE, PROJECT],
    Component: ({ settings }) => {
      const me = useShared<{ id: string }>('/core/me');
      const projects = useShared<Array<{ id: string; name: string }>>('/crm/projects');
      const everything = useShared<Task[]>('/scrum/tasks?includeCompleted=true');

      /*
       * A board is one project's, so this needs one — and picks the obvious one when nobody
       * has said. The project where most of your unfinished work is, which is the board you
       * would have opened anyway. Named in the header so the guess is visible rather than
       * silent.
       */
      const mine = (everything.data ?? []).filter(
        (t) =>
          settings.scope === 'everyone' ||
          !me.data ||
          t.assigneeId === me.data.id ||
          t.assigneeId === null,
      );
      const busiest = [...mine.filter((t) => t.flow !== 'done')]
        .reduce((count, t) => count.set(t.projectId, (count.get(t.projectId) ?? 0) + 1), new Map<string, number>());
      const projectId =
        settings.projectId ||
        [...busiest.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
        '';

      const board = useShared<{ columns: BoardColumn[] }>(projectId ? `/scrum/boards/${projectId}` : null);
      const sprint = useShared<Sprint | null>(projectId ? `/scrum/projects/${projectId}/sprint` : null);

      const cards = mine.filter((t) => t.projectId === projectId);
      const columns = board.data?.columns ?? [];
      const projectName = projects.data?.find((p) => p.id === projectId)?.name;

      /*
       * What is stuck on you, in the order it is stuck.
       *
       * Blocked first — somebody stopped and named a reason — then anything sitting with a
       * client or in review, oldest first. A card you picked up this morning is not on this
       * list; the point is the ones that have stopped moving.
       */
      const stuck = cards
        .filter((t) => t.flow !== 'done')
        .filter((t) => t.blockedReason || t.flow === 'waiting' || t.daysInColumn >= 7)
        .sort((a, b) => Number(Boolean(b.blockedReason)) - Number(Boolean(a.blockedReason)) || b.daysInColumn - a.daysInColumn)
        .slice(0, 3);

      /** The column after this one, which is what "move it on" means. */
      const nextColumn = (status: string) => {
        const at = columns.findIndex((c) => c.key === status);
        return at >= 0 ? columns[at + 1] : undefined;
      };

      const loading = everything.loading || board.loading;

      if (!loading && !projectId) {
        return (
          <Card title="My board">
            <Empty>No project has any work on it yet.</Empty>
          </Card>
        );
      }

      const progress = sprint.data?.progress;
      const done = progress?.unit === 'minutes' ? progress.minutes.done : progress?.cards.done ?? 0;
      const total = progress?.unit === 'minutes' ? progress.minutes.total : progress?.cards.total ?? 0;
      /*
       * Behind, and what that word is allowed to mean here.
       *
       * Elapsed days against delivered work — if two-thirds of the sprint is gone and a third
       * of it is done, you are a third of the sprint behind. It is arithmetic on two numbers
       * the sprint already knows, not a forecast, and it only appears once a sprint has
       * actually started so a planned-but-not-begun one cannot be "behind".
       */
      const pace =
        progress && progress.days.total > 0 && total > 0
          ? (progress.days.elapsed / progress.days.total) * total - done
          : 0;

      return (
        <Card
          title={
            <>
              My board
              {projectName && <span className="board-of"> · {projectName}</span>}
              {sprint.data && <span className="board-of"> · {sprint.data.name}</span>}
            </>
          }
          sub={
            loading
              ? undefined
              : `${cards.filter((t) => t.flow !== 'done').length} open · ${dur(
                  cards.filter((t) => t.flow !== 'done').reduce((n, t) => n + (t.estimateMinutes ?? 0), 0),
                )} estimated`
          }
          to={projectId ? `/board?projectId=${projectId}` : '/board'}
        >
          {loading ? (
            <Skeleton height="7rem" />
          ) : (
            <>
              <div className="board-cols">
                {columns.map((c) => {
                  const inIt = cards.filter((t) => t.status === c.key);
                  const minutes = inIt.reduce((n, t) => n + (t.estimateMinutes ?? 0), 0);
                  const oldest = inIt.reduce((n, t) => Math.max(n, t.daysInColumn ?? 0), 0);
                  return (
                    <div key={c.key} className="board-col" data-flow={c.flow ?? 'active'} data-empty={inIt.length === 0 || undefined}>
                      <span className="board-col-name">{c.label}</span>
                      <span className="board-col-figure">
                        {inIt.length}
                        {/*
                          Points would go here on any other board. They were retired from this
                          codebase — zero cards ever carried one, while ten of eleven carried a
                          minute estimate — so the second figure is the estimate, and where a
                          column is about waiting it is the wait instead.
                        */}
                        <small>
                          {c.flow === 'waiting'
                            ? oldest > 0 && `${oldest}d oldest`
                            : minutes > 0 && dur(minutes)}
                        </small>
                      </span>
                    </div>
                  );
                })}
              </div>

              {stuck.length > 0 && (
                <>
                  <div className="board-section">
                    <span>Needs a move from you</span>
                    <b>{stuck.length}</b>
                  </div>
                  <ul className="act-rows board-stuck">
                    {stuck.map((t) => {
                      const next = nextColumn(t.status);
                      return (
                        <li key={t.id} className="act-row" data-blocked={Boolean(t.blockedReason) || undefined}>
                          <span className="act-row-text">
                            <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                            <small className="card-meta">
                              {t.blockedReason
                                ? `Blocked ${t.daysInColumn}d — ${t.blockedReason}`
                                : `${columns.find((c) => c.key === t.status)?.label ?? t.status}, ${t.daysInColumn} days`}
                            </small>
                          </span>
                          <span className="act-row-buttons">
                            {t.blockedReason ? (
                              <Act variant="primary" run={() => api.post(`/scrum/tasks/${t.id}/unblock`, {})}>
                                Unblock
                              </Act>
                            ) : next ? (
                              // The literal thing the section title asks for, and the reason
                              // this list is worth having on a dashboard rather than a link
                              // to the board.
                              <Act
                                variant="primary"
                                run={() => api.post(`/scrum/tasks/${t.id}/move`, { status: next.key })}
                              >
                                Move to {next.label}
                              </Act>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {progress && total > 0 && (
                <div className="board-foot">
                  <span className="board-bar">
                    <i style={{ width: `${Math.min(100, (done / total) * 100)}%` }} />
                  </span>
                  <span className="card-meta">
                    {progress.unit === 'minutes' ? `${dur(done)} of ${dur(total)}` : `${done} of ${total} cards`}
                    {progress.days.overrun
                      ? ' · past its end date'
                      : ` · day ${progress.days.elapsed} of ${progress.days.total}`}
                  </span>
                  {pace >= 1 && (
                    <b className="board-behind">
                      {progress.unit === 'minutes' ? dur(pace) : `${Math.round(pace)} cards`} behind
                    </b>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      );
    },
  },
};
