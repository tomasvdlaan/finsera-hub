import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';

interface Insight {
  id: string;
  rule: string;
  title: string;
  detail: string | null;
  severity: 'urgent' | 'attention' | 'note';
  subjectType: string | null;
  subjectId: string | null;
}

interface Overview {
  revenueYear?: { totalCents?: number };
  revenueMonth?: { totalCents?: number };
  outstanding?: { totalCents?: number; overdueCents?: number };
  unbilled?: { totalCents?: number };
}

interface DayEntry {
  id: string;
  projectName?: string;
  description: string | null;
  effectiveMinutes: number;
  billable: boolean;
}

interface Day {
  entries: DayEntry[];
  totalMinutes?: number;
}

interface ClientRequest {
  id: string;
  subject: string;
  client_name: string;
}

const euros = (cents = 0) =>
  new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(cents / 100);

const hours = (minutes = 0) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

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
    default:
      return null;
  }
}

/**
 * The front door.
 *
 * `/` used to redirect to `nav[0].path`, which is the client list — and only because
 * CrmModule happens to be registered first in app.module.ts. Every session therefore opened
 * on a list of records, answering "what exists" when the question at the start of a working
 * day is "what now".
 *
 * The rule this page is built on: every number here links to the record behind it or starts
 * a job. A figure you can only read is a figure that belongs on the reporting page.
 *
 * Composed entirely from endpoints that already exist. Nothing here required an API change,
 * which is why it is the second stage rather than the sixth.
 */
export function Today() {
  useDocumentTitle('Today');
  const navigate = useNavigate();

  const [insights, setInsights] = useState<Insight[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [day, setDay] = useState<Day | null>(null);
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);

    /**
     * Each block loads independently and a failure costs only its own block.
     *
     * With Promise.all, one slow or broken endpoint blanks the whole front door — and this
     * page reads from five of them, including two whose modules can be disabled.
     */
    const load = <T,>(path: string, set: (v: T) => void, label: string) =>
      api
        .get<T>(path)
        .then(set)
        .catch((e: Error) => setErrors((all) => [...all, `${label}: ${e.message}`]));

    void load<{ insights: Insight[] } | Insight[]>('/insights?status=open', (r) =>
      setInsights(Array.isArray(r) ? r : (r.insights ?? [])), 'insights');
    void load<Overview>('/reporting/overview', setOverview, 'overview');
    void load<Day>(`/time/day?date=${today}`, setDay, "today's hours");
    void load<ClientRequest[]>('/portal-preview/requests', setRequests, 'client requests');
  }, []);

  const urgent = insights.filter((i) => i.severity === 'urgent');
  const attention = insights.filter((i) => i.severity === 'attention');
  const needsMe = [...urgent, ...attention].slice(0, 6);
  const loggedToday = day?.entries.reduce((n, e) => n + (e.effectiveMinutes ?? 0), 0) ?? 0;

  return (
    <>
      <h1>Today</h1>

      {errors.length > 0 && (
        <p className="muted">
          Some of this could not be loaded: {errors.join(' · ')}
        </p>
      )}

      {/* Money first, because these four numbers are the ones that decide a week. Each is a
          link, because a number you cannot act on belongs on the reporting page. */}
      <div className="stat-row">
        <div className="stat">
          <Link to="/billing">
            <div className="muted">Outstanding</div>
            <div className="stat-value">{euros(overview?.outstanding?.totalCents)}</div>
          </Link>
        </div>
        <div className="stat">
          <Link to="/billing">
            <div className="muted">Overdue</div>
            <div
              className={`stat-value${(overview?.outstanding?.overdueCents ?? 0) > 0 ? ' urgent' : ''}`}
            >
              {euros(overview?.outstanding?.overdueCents)}
            </div>
          </Link>
        </div>
        <div className="stat">
          <Link to="/reporting">
            <div className="muted">Unbilled work</div>
            <div className="stat-value">{euros(overview?.unbilled?.totalCents)}</div>
          </Link>
        </div>
        <div className="stat">
          <Link to="/time">
            <div className="muted">Logged today</div>
            <div className="stat-value">{hours(loggedToday)}</div>
          </Link>
        </div>
      </div>

      <section>
        <h2>Needs you</h2>
        {needsMe.length === 0 ? (
          <p className="muted">
            Nothing urgent. {insights.length > 0 && `${insights.length} quieter things are in `}
            {insights.length > 0 ? <Link to="/insights">the full list</Link> : 'The queue is empty.'}
          </p>
        ) : (
          <table>
            <tbody>
              {needsMe.map((i) => {
                const path = subjectPath(i);
                return (
                  <tr key={i.id}>
                    <td style={{ width: '1%', whiteSpace: 'nowrap' }}>
                      <span className={`tag${i.severity === 'urgent' ? ' overdue' : ''}`}>
                        {i.severity === 'urgent' ? 'urgent' : 'attention'}
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
        {insights.length > needsMe.length && (
          <p>
            <Link to="/insights">All {insights.length} open</Link>
          </p>
        )}
      </section>

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
            Nothing logged yet.{' '}
            <button className="link-button" onClick={() => navigate('/time')}>
              Open the timesheet
            </button>
          </p>
        ) : (
          <table>
            <tbody>
              {day?.entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ width: '1%', whiteSpace: 'nowrap' }}>{hours(e.effectiveMinutes)}</td>
                  <td>
                    <Link to="/time">{e.projectName ?? 'Project'}</Link>
                    {e.description && <span className="muted"> — {e.description}</span>}
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
