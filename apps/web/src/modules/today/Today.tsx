import { useEffect, useState } from 'react';
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
      return `/billing/invoices/${i.subjectId}`;
    case 'quote':
      return `/sales/quotes/${i.subjectId}`;
    case 'contract':
      return `/sales/contracts/${i.subjectId}`;
    case 'project':
      return `/crm/projects/${i.subjectId}`;
    case 'client':
      return `/crm/clients/${i.subjectId}`;
    case 'task':
      return `/scrum/tasks/${i.subjectId}`;
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
export function Today() {
  useDocumentTitle('Today');

  const [insights, setInsights] = useState<Insight[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [day, setDay] = useState<{ entries: DayEntry[] } | null>(null);
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

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
    // Everything still open, whatever its column is called.
    void load<Task[]>('/scrum/tasks', setTasks, 'work');
    void load<{ entries: DayEntry[] }>(`/time/day?date=${today}`, setDay, "today's hours");
    void load<ClientRequest[]>('/portal-preview/requests', setRequests, 'client requests');
    api.get<Project[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
  }, []);

  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const inFlow = (...roles: Task['flow'][]) => tasks.filter((t) => roles.includes(t.flow));
  const doing = inFlow('active');
  const waiting = inFlow('waiting');
  const next = inFlow('queue');

  const today = new Date().toISOString().slice(0, 10);
  const overdue = tasks.filter((t) => t.dueOn && t.dueOn < today);
  const dueToday = tasks.filter((t) => t.dueOn === today);

  // Work first in the queue, because it is what the page is for — the ordering is the thesis.
  const needsMe = insights
    .filter((i) => i.severity === 'urgent' || i.severity === 'attention')
    .sort((a, b) => Number(MONEY_RULES.has(a.rule)) - Number(MONEY_RULES.has(b.rule)));

  const moneyItems = needsMe.filter((i) => MONEY_RULES.has(i.rule));
  const workItems = needsMe.filter((i) => !MONEY_RULES.has(i.rule));

  const loggedToday = day?.entries.reduce((n, e) => n + (e.effectiveMinutes ?? 0), 0) ?? 0;

  const card = (t: Task) => (
    <li key={t.id}>
      <Link to={`/scrum/tasks/${t.id}`}>{t.title}</Link>
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
      <h1>Today</h1>

      {errors.length > 0 && (
        <p className="muted">Some of this could not be loaded: {errors.join(' · ')}</p>
      )}

      {/* Work, in the space the money tiles used to occupy. */}
      <div className="stat-row">
        <div className="stat">
          <Link to="/work">
            <div className="muted">In progress</div>
            <div className={`stat-value${doing.length === 0 ? ' is-zero' : ''}`}>{doing.length}</div>
          </Link>
        </div>
        <div className="stat">
          <Link to="/work">
            <div className="muted">Waiting on a client</div>
            <div className={`stat-value${waiting.length === 0 ? ' is-zero' : ''}`}>{waiting.length}</div>
          </Link>
        </div>
        <div className="stat">
          <Link to="/work">
            <div className="muted">Overdue</div>
            <div className={`stat-value${overdue.length > 0 ? ' urgent' : ' is-zero'}`}>
              {overdue.length}
            </div>
          </Link>
        </div>
        <div className="stat">
          <Link to="/time">
            <div className="muted">Logged today</div>
            <div className={`stat-value${loggedToday === 0 ? ' is-zero' : ''}`}>{hours(loggedToday)}</div>
          </Link>
        </div>
      </div>

      {(workItems.length > 0 || moneyItems.length > 0) && (
        <section>
          <h2>Needs you</h2>
          {workItems.length === 0 && <Empty>Nothing about the work itself.</Empty>}
          {workItems.length > 0 && (
            <table>
              <tbody>
                {workItems.map((i) => {
                  const path = subjectPath(i);
                  return (
                    <tr key={i.id}>
                      <td style={{ width: '1%', whiteSpace: 'nowrap' }}>
                        <span className={`tag${i.severity === 'urgent' ? ' overdue' : ''}`}>
                          {i.severity}
                        </span>
                      </td>
                      <td>
                        {path ? <Link to={path}>{i.title}</Link> : i.title}
                        {i.detail && <div className="muted">{i.detail}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
        </section>
      )}

      <section>
        <h2>Doing</h2>
        {doing.length === 0 ? (
          <p className="muted">
            Nothing in progress. <Link to="/work">Pick something up</Link>
            {next.length > 0 && ` — ${next.length} waiting in To do.`}
          </p>
        ) : (
          <ul>{doing.map(card)}</ul>
        )}
      </section>

      {waiting.length > 0 && (
        <section>
          <h2>Waiting on someone else</h2>
          <ul>{waiting.map(card)}</ul>
          <p className="muted">
            Nothing here is yours to move — but a fortnight of silence is worth a nudge.
          </p>
        </section>
      )}

      {dueToday.length > 0 && (
        <section>
          <h2>Due today</h2>
          <ul>{dueToday.map(card)}</ul>
        </section>
      )}

      {requests.length > 0 && (
        <section>
          <h2>Clients have asked for</h2>
          <table>
            <tbody>
              {requests.slice(0, 5).map((r) => (
                <tr key={r.id}>
                  <td style={{ width: '1%', whiteSpace: 'nowrap' }} className="muted">
                    {r.client_name}
                  </td>
                  <td>
                    <Link to="/portal/requests">{r.subject}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2>Hours today</h2>
        {loggedToday === 0 ? (
          <p className="muted">
            Nothing logged yet. <Link to="/time">Open the timesheet</Link>
          </p>
        ) : (
          <table>
            <tbody>
              {day?.entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ width: '1%', whiteSpace: 'nowrap' }}>
                    {hours(e.effectiveMinutes)}
                  </td>
                  <td>
                    {/* Linked to the card it was logged against where there is one, which is
                        the point of logging against a card. */}
                    {e.taskId ? (
                      <Link to={`/scrum/tasks/${e.taskId}`}>
                        {e.description || e.projectName || 'Work'}
                      </Link>
                    ) : (
                      <>
                        <Link to="/time">{e.projectName ?? 'Project'}</Link>
                        {e.description && <span className="muted"> — {e.description}</span>}
                      </>
                    )}
                  </td>
                  <td style={{ width: '1%' }}>
                    {!e.billable && <span className="tag">non-billable</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
