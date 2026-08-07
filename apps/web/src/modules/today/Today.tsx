import { useEffect, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { DataTable } from '../../shell/ui/data.js';
import { Card, Figure } from '../../shell/ui/card.js';
import { Rhythm } from '../../shell/ui/viz.js';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import { Empty } from '../../shell/ui/primitives.js';

interface Insight {
  id: string;
  rule: string;
  title: string;
  detail: string | null;
  severity: 'urgent' | 'attention' | 'note' | 'info';
  subjectType: string | null;
  subjectId: string | null;
}

interface Task {
  id: string;
  projectId: string;
  title: string;
  status: string;
  /** What the card's column means. See the grouping below for why the name is not enough. */
  flow: 'queue' | 'active' | 'waiting' | 'done';
  priority: string;
  dueOn: string | null;
  assigneeId: string | null;
  /** How long the card has sat where it is. Decorated by listTasks from the transitions. */
  daysInColumn: number;
}

interface Project {
  id: string;
  name: string;
}

interface DayEntry {
  id: string;
  taskId: string | null;
  projectName?: string;
  description: string | null;
  effectiveMinutes: number;
  billable: boolean;
}

interface Day {
  date: string;
  totalMinutes: number;
}

interface ClientRequest {
  id: string;
  subject: string;
  client_name: string;
}

const hours = (minutes = 0) =>
  `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

/*
 * What is moving, what is stuck, what is next.
 *
 * These used to be three lists of column keys written out here, which meant a board whose
 * columns had been renamed — something board settings invites you to do — silently dropped its
 * work off this page. Each card now carries its column's role, so the grouping follows the
 * board instead of guessing at it.
 */

/** Where an insight points, so a line of text becomes a way to deal with the thing. */
function subjectPath(i: Insight): string | null {
  switch (i.subjectType) {
    case 'invoice':
      return `/money/invoices/${i.subjectId}`;
    case 'quote':
      return `/money/quotes/${i.subjectId}`;
    case 'contract':
      return `/money/contracts/${i.subjectId}`;
    case 'project':
      return `/projects/${i.subjectId}`;
    case 'client':
      return `/clients/${i.subjectId}`;
    case 'task':
      return `/tasks/${i.subjectId}`;
    case 'sprint':
      return `/board/sprints/${i.subjectId}`;
    case 'meeting':
      return `/meetings/${i.subjectId}`;
    default:
      return null;
  }
}

/** Rules about money, so the front door can say "money" in one line instead of four tiles. */
const MONEY_RULES = new Set([
  'invoice_overdue',
  'unbilled_work_ageing',
  'quote_unanswered',
  'quote_accepted_by_client',
  'contract_notice_closing',
  'budget_nearly_spent',
]);

/**
 * The front door, about the work.
 *
 * The first version of this page led with four money tiles, which encoded an assumption about
 * what the business is that turned out to be wrong: this is a productivity tool that happens
 * to track time, and money is an outcome. So the work comes first and money is one line, shown
 * only when something is actually wrong.
 *
 * `GET /reporting/overview` is deliberately gone from here. It fans out to seven aggregates
 * including a year of revenue and a full unbilled scan, on every single page load, to fill
 * tiles whose contents an insight rule already computes every six hours. The money line below
 * is derived from those same insights, so the front door costs nothing to render and the
 * numbers still reach you.
 */
/**
 * One sentence on the state of things, assembled from what is actually true.
 *
 * At most two clauses, in priority order — decisions first because they are the only items
 * here that are waiting on a person rather than on time. A line that tries to say everything
 * says nothing, and a line that is always the same is a greeting.
 *
 * "Nothing is on fire" is a real answer and worth printing. The alternative is an empty space
 * where a status used to be, which reads as a page that failed to load.
 */
function stateOfPlay({
  workItems,
  overdue,
  blocked,
  loggedToday,
}: {
  workItems: Insight[];
  overdue: Task[];
  blocked: Task[];
  loggedToday: number;
}): string {
  const clauses: string[] = [];
  if (workItems.length > 0) {
    clauses.push(
      `${workItems.length} ${workItems.length === 1 ? 'thing needs' : 'things need'} a decision`,
    );
  }
  if (overdue.length > 0) clauses.push(`${overdue.length} past due`);
  if (blocked.length > 0) clauses.push(`${blocked.length} with a client`);
  if (clauses.length === 0 && loggedToday === 0) return 'Nothing is on fire, and nothing is logged yet.';
  if (clauses.length === 0) return 'Nothing is on fire.';
  return `${clauses.slice(0, 2).join(', ')}.`;
}

export function Today() {
  useDocumentTitle('Today');

  const [insights, setInsights] = useState<Insight[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [day, setDay] = useState<{ entries: DayEntry[] } | null>(null);
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [recent, setRecent] = useState<Day[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [me, setMe] = useState<{ id: string; displayName: string } | null>(null);
  /*
   * Whose day this is.
   *
   * `/scrum/tasks` has accepted `assigneeId` since the controller was written and no screen
   * has ever passed it — so a page called Today has been showing the whole company's work in
   * progress under a heading that says "Doing". Remembered, because the answer is a habit
   * rather than a decision you make each morning.
   */
  const [scope, setScope] = useState<'mine' | 'everyone'>(
    () => (localStorage.getItem('finsera.today.scope') as 'mine' | 'everyone') ?? 'mine',
  );

  useEffect(() => {
    localStorage.setItem('finsera.today.scope', scope);
  }, [scope]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);

    /**
     * Each block loads independently, so a failure costs only its own block.
     *
     * With Promise.all one broken endpoint blanks the whole front door, and this page reads
     * from four of them.
     */
    const load = <T,>(path: string, set: (v: T) => void, label: string) =>
      api
        .get<T>(path)
        .then(set)
        .catch((e: Error) => setErrors((all) => [...all, `${label}: ${e.message}`]));

    void load<Insight[]>('/insights?status=open', setInsights, 'attention');
    void api
      .get<{ id: string; displayName: string }>('/core/me')
      .then(setMe)
      .catch(() => setMe(null));
    // Everything still open, whatever its column is called.
    void load<Task[]>('/scrum/tasks', setTasks, 'work');
    void load<{ entries: DayEntry[] }>(`/time/day?date=${today}`, setDay, "today's hours");
    void load<ClientRequest[]>('/portal-preview/requests', setRequests, 'client requests');
    void api
      .get<{ days: Day[] }>('/time/recent')
      .then((r) => setRecent(r.days))
      .catch(() => setRecent([]));
    api.get<Project[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
  }, []);

  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  /*
   * Unassigned counts as mine.
   *
   * At two to four people an unowned card is not somebody else's — it is nobody's, and
   * nobody's is exactly the thing a front door should not hide. Ten of eleven cards on the
   * real board have no assignee, so filtering them out would empty the page.
   */
  const mine =
    scope === 'everyone' || !me
      ? tasks
      : tasks.filter((t) => t.assigneeId === me.id || t.assigneeId === null);
  const inFlow = (...roles: Task['flow'][]) => mine.filter((t) => roles.includes(t.flow));
  const doing = inFlow('active');
  const waiting = inFlow('waiting');
  const next = inFlow('queue');

  const today = new Date().toISOString().slice(0, 10);
  const overdue = mine.filter((t) => t.dueOn && t.dueOn < today);
  const dueToday = mine.filter((t) => t.dueOn === today);
  /*
   * How long the most patient client has been waiting.
   *
   * From `daysInColumn`, which the server derives from the column transitions rather than from
   * `updated_at` — a card whose title was corrected is not a card that was worked on, and that
   * distinction is the whole reason the transitions table exists.
   */
  const oldestWait = waiting.reduce((n, t) => Math.max(n, t.daysInColumn ?? 0), 0);

  // Work first in the queue, because it is what the page is for — the ordering is the thesis.
  const needsMe = insights
    .filter((i) => i.severity === 'urgent' || i.severity === 'attention')
    .sort((a, b) => Number(MONEY_RULES.has(a.rule)) - Number(MONEY_RULES.has(b.rule)));

  const moneyItems = needsMe.filter((i) => MONEY_RULES.has(i.rule));
  const workItems = needsMe.filter((i) => !MONEY_RULES.has(i.rule));

  const loggedToday = day?.entries.reduce((n, e) => n + (e.effectiveMinutes ?? 0), 0) ?? 0;

  /*
   * Fourteen days, including the ones with nothing on them.
   *
   * `/time/recent` returns only days that have an entry, so plotting it directly draws a
   * fortnight of solid bars and tells you the opposite of the truth. The empty days are the
   * finding: a month where two days carry everything and eleven are blank is the shape that
   * predicts a month-end scramble, and no total can show it.
   */
  const fortnight = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const date = d.toISOString().slice(0, 10);
    return { date, value: (recent.find((r) => r.date === date)?.totalMinutes ?? 0) / 60 };
  });
  const fortnightHours = fortnight.reduce((n, d) => n + d.value, 0);
  const daysWorked = fortnight.filter((d) => d.value > 0).length;

  const card = (t: Task) => (
    <li key={t.id}>
      <Link to={`/tasks/${t.id}`}>{t.title}</Link>
      <span className="muted">
        {' '}
        {projectName.get(t.projectId) ?? ''}
        {t.dueOn && t.dueOn < today && <span className="tag overdue"> overdue {t.dueOn}</span>}
        {t.dueOn === today && <span className="tag"> due today</span>}
      </span>
    </li>
  );

  return (
    <>
      {/*
        The date, and one sentence about the state of things.
        
        No greeting. A front door that says "Good morning" every morning is a front door that
        has nothing to tell you — the line below is assembled from what is actually true, in
        priority order, and says so plainly when the answer is "nothing".
      */}
      <PageHeader
        title={new Date().toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
        subtitle={stateOfPlay({ workItems, overdue, blocked: waiting, loggedToday })}
        actions={
          <div className="segmented" role="group" aria-label="Whose work to show">
            <button
              type="button"
              data-on={scope === 'mine' || undefined}
              onClick={() => setScope('mine')}
            >
              Mine
            </button>
            <button
              type="button"
              data-on={scope === 'everyone' || undefined}
              onClick={() => setScope('everyone')}
            >
              Everyone
            </button>
          </div>
        }
      />

      {errors.length > 0 && (
        <p className="muted">Some of this could not be loaded: {errors.join(' · ')}</p>
      )}

      {/*
        Work, in the space the money tiles used to occupy.

        Only two of the four can carry a tone, and only when the number earns it: a zero in
        Overdue is good news, and rendering it in the alarming colour makes a clean board look
        exactly as bad as a late one. Waiting is amber only past a week, because a client
        taking two days is not a problem.
      */}
      <Card span={3} to="/work">
        <Figure
          label="In progress"
          value={doing.length}
          note={
            doing.length === 0
              ? 'nothing picked up'
              : `across ${new Set(doing.map((t) => t.projectId)).size} ${
                  new Set(doing.map((t) => t.projectId)).size === 1 ? 'project' : 'projects'
                }`
          }
        />
      </Card>
      <Card span={3} to="/work" tone={oldestWait >= 7 ? 'warning' : undefined}>
        <Figure
          label="Waiting on a client"
          value={waiting.length}
          note={oldestWait > 0 ? `longest is ${oldestWait} days` : 'nothing sitting with anyone'}
        />
      </Card>
      <Card span={3} to="/work" tone={overdue.length > 0 ? 'danger' : undefined}>
        <Figure label="Overdue" value={overdue.length} note={overdue.length === 0 ? 'nothing past its date' : 'past the date on the card'} />
      </Card>
      <Card span={3} to="/time">
        <Figure label="Logged today" value={hours(loggedToday)} />
      </Card>

      {(workItems.length > 0 || moneyItems.length > 0) && (
        <Card
          span={7}
          title="Needs you"
          sub={`${needsMe.length} open · nothing here has been acted on`}
          tone={workItems.some((i) => i.severity === 'urgent') ? 'danger' : undefined}
        >
          {workItems.length === 0 && <Empty>Nothing about the work itself.</Empty>}
          {workItems.length > 0 && (
            <DataTable
              caption="Work needing a decision"
              rows={workItems}
              rowKey={(i) => i.id}
              columns={[
                {
                  key: 'severity',
                  align: 'action',
                  render: (i) => (
                    <span className={`tag${i.severity === 'urgent' ? ' overdue' : ''}`}>
                      {i.severity}
                    </span>
                  ),
                },
                {
                  key: 'what',
                  render: (i) => {
                    const path = subjectPath(i);
                    return (
                      <>
                        {path ? <Link to={path}>{i.title}</Link> : i.title}
                        {i.detail && <div className="muted">{i.detail}</div>}
                      </>
                    );
                  },
                },
              ]}
            />
          )}

          {/* One line, not four tiles. Every figure behind it is computed by a rule that runs
              on its own every six hours, so it reaches you whether or not you read this. */}
          {moneyItems.length > 0 && (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              {moneyItems.length === 1
                ? 'One money thing needs attention'
                : `${moneyItems.length} money things need attention`}{' '}
              — <Link to="/money">Money</Link>
              {moneyItems.some((i) => i.severity === 'urgent') && (
                <span className="tag overdue"> including urgent</span>
              )}
            </p>
          )}
        </Card>
      )}

      {/*
        The fortnight, which this page has never shown.

        A page called Today that only ever showed today could not answer the question the hours
        are actually for — whether this is a normal week. Fourteen bars can, in the space a
        sentence was using.
      */}
      <Card
        span={5}
        title="Your fortnight"
        sub={`${fortnightHours.toFixed(1).replace('.', ',')} h over ${daysWorked} of 14 days`}
        to="/time"
      >
        <div className="card-fill">
          <Rhythm days={fortnight} />
        </div>
      </Card>

      <Card span={5} title="Doing">
        {doing.length === 0 ? (
          <p className="muted">
            Nothing in progress. <Link to="/work">Pick something up</Link>
            {next.length > 0 && ` — ${next.length} waiting in To do.`}
          </p>
        ) : (
          <ul>{doing.map(card)}</ul>
        )}
      </Card>

      {waiting.length > 0 && (
        <Card
          span={7}
          title="Waiting on someone else"
          sub="Nothing here is yours to move — but a fortnight of silence is worth a nudge."
          tone={oldestWait >= 7 ? 'warning' : undefined}
        >
          <ul>{waiting.map(card)}</ul>
        </Card>
      )}

      {dueToday.length > 0 && (
        <Card span={5} title="Due today">
          <ul>{dueToday.map(card)}</ul>
        </Card>
      )}

      {requests.length > 0 && (
        <Card span={6} title="Clients have asked for" to="/portal/requests">
          <DataTable
            caption="Requests from clients"
            rows={requests.slice(0, 5)}
            rowKey={(r) => r.id}
            columns={[
              { key: 'client', align: 'action', render: (r) => <span className="muted">{r.client_name}</span> },
              { key: 'subject', render: (r) => <Link to="/portal/requests">{r.subject}</Link> },
            ]}
          />
        </Card>
      )}

      <Card span={6} title="Hours today" to="/time">
        {loggedToday === 0 ? (
          <p className="muted">
            Nothing logged yet. <Link to="/time">Open the timesheet</Link>
          </p>
        ) : (
          <DataTable
            caption="Hours logged today"
            rows={day?.entries ?? []}
            rowKey={(e) => e.id}
            columns={[
              { key: 'hours', align: 'num', render: (e) => hours(e.effectiveMinutes) },
              {
                key: 'what',
                render: (e) => (
                  <>
                    {/* Linked to the card it was logged against where there is one, which is
                        the point of logging against a card. */}
                    {e.taskId ? (
                      <Link to={`/tasks/${e.taskId}`}>
                        {e.description || e.projectName || 'Work'}
                      </Link>
                    ) : (
                      <>
                        <Link to="/time">{e.projectName ?? 'Project'}</Link>
                        {e.description && <span className="muted"> — {e.description}</span>}
                      </>
                    )}
                  </>
                ),
              },
              {
                key: 'billable',
                align: 'action',
                render: (e) => (!e.billable ? <span className="tag">non-billable</span> : null),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
