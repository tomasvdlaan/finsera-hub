import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Block, PageHeader } from './ui/layout.js';
import { Card } from './ui/card.js';
import { Avatar, Empty } from './ui/primitives.js';
import { DataTable } from './ui/data.js';
import { ExportHours } from '../modules/time/ExportHours.js';
import { api } from '../lib/api.js';
import { shiftDay, todayIso } from '../lib/dates.js';
import { useDocumentTitle } from './useDocumentTitle.js';

/**
 * One colleague, and what they have actually been doing.
 *
 * The question this answers is the owner's, and until now nothing did: what is this person on,
 * what is on their plate, where did their hours go, and what have they touched. Every part of
 * that was already in the database and reachable only by asking four different screens the
 * wrong question — `/scrum/tasks` has taken `assigneeId` since it was written, `/core/activity`
 * has taken `actorId`, and `getRecent` has taken `personId` with no route passing it.
 *
 * Behind `core.people.manage`, which is admin-only. That is deliberate and it is the same gate
 * the directory sits behind: this page carries somebody's contracted hours and their cost rate,
 * and a page about a person is not the same thing as a page about the work.
 *
 * It is a record of facts, not an assessment. There is no score, no ranking against a
 * colleague, and no generated prose about somebody — the activity log says what happened and
 * the reader draws their own conclusion. At two-to-four people any per-person metric is noisy
 * enough to mislead, and a number next to a name gets used.
 */

interface Person {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'member';
  isActive: boolean;
  jobTitle: string | null;
  startedOn: string | null;
  weeklyHours: number | null;
  /** Absent entirely — not null — when the viewer is not an admin. */
  costRateCents?: number | null;
}

interface ProjectMembership {
  projectId: string;
  name: string;
  clientName: string;
  status: string;
  role: 'lead' | 'contributor';
}

interface Task {
  id: string;
  title: string;
  projectId: string;
  status: string;
  flow: 'queue' | 'active' | 'waiting' | 'done';
  dueOn: string | null;
  blockedReason: string | null;
}

interface TimeDay {
  date: string;
  totalMinutes: number;
  entries: Array<{ id: string; effectiveMinutes: number; billable: boolean }>;
}

interface ActivityRow {
  eventId: string;
  eventName: string;
  createdAt: string;
  subject: { id: string; displayName: string; urlPath: string; entityType: string } | null;
}

/** How far back the page looks. A fortnight is the unit the rest of the platform reasons in. */
const WINDOWS = [
  { key: '14', label: 'Fortnight', days: 14 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: 'Quarter', days: 90 },
] as const;

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}h`;

const money = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

const WHEN = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/**
 * An event name, said as a person would say it.
 *
 * The log stores `task.completed`; printing that verbatim makes a page about a colleague read
 * like a server log. Unknown names fall through to the raw string rather than being dropped —
 * a new event type should look unpolished, not invisible.
 */
const VERB: Record<string, string> = {
  'task.created': 'created', 'task.completed': 'finished', 'task.moved': 'moved',
  'task.blocked': 'blocked', 'task.unblocked': 'unblocked', 'task.assigned': 'took on',
  'time_entry.created': 'logged time on', 'meeting_note.created': 'started', 'meeting_note.finalised': 'finalised',
  'invoice.issued': 'issued', 'invoice.paid': 'recorded payment on', 'quote.sent': 'sent',
  'quote.accepted': 'closed', 'client.created': 'added', 'project.created': 'created',
  'document.uploaded': 'filed', 'sprint.started': 'started', 'sprint.completed': 'closed',
};

export function PersonDetail() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const window = WINDOWS.find((w) => w.key === params.get('window')) ?? WINDOWS[0];

  const [person, setPerson] = useState<Person>();
  const [projects, setProjects] = useState<ProjectMembership[]>();
  const [tasks, setTasks] = useState<Task[]>();
  const [time, setTime] = useState<{ days: TimeDay[] }>();
  const [activity, setActivity] = useState<ActivityRow[]>();
  const [failed, setFailed] = useState<Record<string, string>>({});

  useDocumentTitle(person?.displayName ?? 'Person');

  const from = useMemo(() => shiftDay(todayIso(), -(window.days - 1)), [window.days]);
  const to = todayIso();

  /*
   * Five reads, five independent failures.
   *
   * The same discipline the agenda and the dashboard keep: a page assembled from several
   * modules must not let one of them decide whether anything renders. A missing block says so
   * where it sits, and the rest of the page stays true.
   */
  useEffect(() => {
    if (!id) return;
    const fail = (key: string) => (e: Error) => setFailed((f) => ({ ...f, [key]: e.message }));

    api.get<Person>(`/core/people/${id}`).then(setPerson).catch(fail('person'));
    api.get<ProjectMembership[]>(`/crm/people/${id}/projects`).then(setProjects).catch(fail('projects'));
    api.get<Task[]>(`/scrum/tasks?assigneeId=${id}`).then(setTasks).catch(fail('tasks'));
    api
      .get<{ days: TimeDay[] }>(`/time/recent?personId=${id}&from=${from}&to=${to}`)
      .then(setTime)
      .catch(fail('time'));
    api
      .get<ActivityRow[]>(`/core/activity?actorId=${id}&since=${from}T00:00:00Z&limit=60`)
      .then(setActivity)
      .catch(fail('activity'));
  }, [id, from, to]);

  const open = (tasks ?? []).filter((t) => t.flow !== 'done');
  const blocked = open.filter((t) => t.blockedReason);
  const minutes = (time?.days ?? []).reduce((sum, d) => sum + d.totalMinutes, 0);
  const billable = (time?.days ?? []).reduce(
    (sum, d) => sum + d.entries.filter((e) => e.billable).reduce((s, e) => s + e.effectiveMinutes, 0),
    0,
  );

  /*
   * Contracted hours are the denominator, and there is no fallback.
   *
   * A default of forty would put a utilisation percentage on a colleague's page that nobody
   * entered — the same refusal `SprintDetail` makes about capacity, for the same reason: a
   * fabricated denominator looks authoritative and is fiction.
   */
  const expected = person?.weeklyHours ? person.weeklyHours * (window.days / 7) : null;
  const utilisation = expected ? Math.round((minutes / 60 / expected) * 100) : null;

  if (failed.person) {
    return (
      <>
        <PageHeader title="Person" back={{ to: '/settings/people', label: 'People' }} />
        <Card tone="danger">
          <p style={{ margin: 0 }}>{failed.person}</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={person?.displayName ?? '…'}
        subtitle={
          person
            ? [person.jobTitle, person.role === 'admin' ? 'Administrator' : null, person.email]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        back={{ to: '/settings/people', label: 'People' }}
        tabs={WINDOWS.map((w) => (
          <button
            key={w.key}
            type="button"
            className={w.key === window.key ? 'page-tab active' : 'page-tab'}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('window', w.key);
              setParams(next, { replace: true });
            }}
          >
            {w.label}
          </button>
        ))}
      />

      {/* ── Aside: who they are, and what they are on ── */}
      <Block span={4}>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Card title="The person">
            <div className="person-head">
              {person && <Avatar id={person.id} name={person.displayName} size="md" />}
              <div>
                <div className="person-name">{person?.displayName ?? '…'}</div>
                <div className="muted">{person?.jobTitle ?? 'No job title set'}</div>
              </div>
            </div>
            <dl className="terms">
              <dt>Contracted</dt>
              <dd>{person?.weeklyHours ? `${person.weeklyHours}h a week` : <span className="muted">not set</span>}</dd>
              <dt>Started</dt>
              <dd>{person?.startedOn ?? <span className="muted">not recorded</span>}</dd>
              <dt>Status</dt>
              <dd>{person?.isActive === false ? 'Deactivated' : 'Active'}</dd>
              {/* Absent, not null, when the viewer is not an admin — so this row simply is not here. */}
              {person && 'costRateCents' in person && (
                <>
                  <dt>Cost rate</dt>
                  <dd>
                    {person.costRateCents != null ? (
                      `${money(person.costRateCents)}/h`
                    ) : (
                      <span className="muted">not set</span>
                    )}
                  </dd>
                </>
              )}
            </dl>
          </Card>

          <Card
            title="On these projects"
            sub={projects ? `${projects.length} active` : undefined}
            loading={!projects && !failed.projects}
            error={failed.projects}
          >
            {projects?.length === 0 ? (
              <Empty>
                Not on any project yet. Adding somebody to a project is how the board, the
                assignee pickers and this page learn what they work on.
              </Empty>
            ) : (
              <ul className="cards">
                {(projects ?? []).map((p) => (
                  <li key={p.projectId}>
                    <Link to={`/projects/${p.projectId}`}>{p.name}</Link>
                    <div className="card-meta">
                      {p.clientName}
                      {p.role === 'lead' && ' · leads it'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Block>

      {/* ── Main: the hours, the plate, and the record ── */}
      <Block span={8}>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Card
            title={`Hours · last ${window.days} days`}
            loading={!time && !failed.time}
            error={failed.time}
          >
            <div className="person-figures">
              <div>
                <div className="label">Logged</div>
                <div className="stat-value">{hours(minutes)}</div>
              </div>
              <div>
                <div className="label">Billable</div>
                <div className="stat-value">
                  {minutes === 0 ? '—' : `${Math.round((billable / minutes) * 100)}%`}
                </div>
              </div>
              <div>
                <div className="label">Against contract</div>
                <div className="stat-value">
                  {utilisation === null ? <span className="muted">no contract set</span> : `${utilisation}%`}
                </div>
              </div>
              <div>
                <div className="label">Days with hours</div>
                <div className="stat-value">{(time?.days ?? []).filter((d) => d.totalMinutes > 0).length}</div>
              </div>
            </div>
            {/* The same period as the figures above it — exporting a different window than the
                one on screen is how somebody sends the wrong file. */}
            <div className="person-export">
              <ExportHours from={from} to={to} personId={id} />
            </div>
          </Card>

          <Card
            title="On their plate"
            sub={blocked.length > 0 ? `${blocked.length} blocked` : undefined}
            tone={blocked.length > 0 ? 'warning' : undefined}
            loading={!tasks && !failed.tasks}
            error={failed.tasks}
          >
            {open.length === 0 ? (
              <Empty>Nothing open is assigned to them.</Empty>
            ) : (
              <DataTable
                rows={open}
                rowKey={(t) => t.id}
                columns={[
                  {
                    key: 'title',
                    header: 'Card',
                    render: (t) => (
                      <>
                        <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                        {t.blockedReason && <div className="card-meta">Blocked — {t.blockedReason}</div>}
                      </>
                    ),
                  },
                  { key: 'status', header: 'Status', render: (t) => t.status },
                  {
                    key: 'due',
                    header: 'Due',
                    align: 'num',
                    render: (t) =>
                      t.dueOn ? (
                        <span className={t.dueOn < to ? 'overdue' : undefined}>{t.dueOn}</span>
                      ) : (
                        <span className="muted">—</span>
                      ),
                  },
                ]}
              />
            )}
          </Card>

          <Card
            title="What they did"
            sub={`Every change they made in the last ${window.days} days`}
            loading={!activity && !failed.activity}
            error={failed.activity}
          >
            {activity?.length === 0 ? (
              <Empty>
                Nothing recorded in this window. The log covers changes to records — hours
                logged, cards moved, notes written — not time spent reading.
              </Empty>
            ) : (
              <ul className="person-activity">
                {(activity ?? []).map((row) => (
                  <li key={row.eventId}>
                    <span className="person-activity-when">
                      {WHEN.format(new Date(row.createdAt))}
                    </span>
                    <span>
                      {VERB[row.eventName] ?? row.eventName}{' '}
                      {row.subject ? (
                        <Link to={row.subject.urlPath}>{row.subject.displayName}</Link>
                      ) : (
                        <span className="muted">a record that has since gone</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Block>
    </>
  );
}
