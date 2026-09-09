import { useEffect, useState } from 'react';
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
  departmentIds: string[];
}

interface Department {
  id: string;
  key: string;
  label: string;
}

/** What the identity provider knows. Null when it has never heard of the address. */
interface Account {
  userId: string;
  active: boolean;
  loginNames: string[];
  emailVerified: boolean;
  passwordChangedAt: string | null;
  createdAt: string | null;
  consoleUrl: string;
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

/** One "was here" line: the platform itself, or a client's portal opened as staff. */
interface SignIn {
  at: string;
  surface: 'platform' | 'portal';
  clientName: string | null;
}

interface ActivityRow {
  eventId: string;
  eventName: string;
  createdAt: string;
  subject: { id: string; displayName: string; urlPath: string; entityType: string } | null;
}

/** How far back the page looks. A fortnight is the unit the rest of the platform reasons in. */
/**
 * Ranges worth one click, not a set of views.
 *
 * These were tabs, and a tab says "this is one of the few things this page shows". The page
 * shows one thing — this person — over whatever stretch of time you are asking about, and
 * the honest control for that is two dates. The presets remain because "the last 30 days" is
 * two date-picker journeys otherwise; they write into the same two fields rather than
 * switching anything, so nothing is hidden behind them.
 */
const PRESETS = [
  { label: 'Fortnight', days: 14 },
  { label: '30 days', days: 30 },
  { label: 'Quarter', days: 90 },
  { label: 'Year', days: 365 },
] as const;

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}h`;

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

  /*
   * The range lives in the URL, so a person and a period is one link.
   *
   * Defaulted rather than stored: a colleague sent "look at October" should see October, and
   * anybody arriving without a range gets the fortnight the tabs used to open on.
   */
  const to = params.get('to') || todayIso();
  const from = params.get('from') || shiftDay(to, -13);

  const setRange = (next: { from: string; to: string }) => {
    const q = new URLSearchParams(params);
    q.set('from', next.from);
    q.set('to', next.to);
    setParams(q, { replace: true });
  };
  /* Said once. Two cards describing the same range in two ways is how a reader concludes
     they are looking at two different things. */
  const rangeLabel = from === to ? `on ${from}` : `from ${from} to ${to}`;

  const preset = (days: number) => {
    const end = todayIso();
    setRange({ from: shiftDay(end, -(days - 1)), to: end });
  };

  const [person, setPerson] = useState<Person>();
  const [projects, setProjects] = useState<ProjectMembership[]>();
  const [tasks, setTasks] = useState<Task[]>();
  const [time, setTime] = useState<{ days: TimeDay[] }>();
  const [activity, setActivity] = useState<ActivityRow[]>();
  const [signIns, setSignIns] = useState<SignIn[]>();
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [departments, setDepartments] = useState<Department[]>([]);
  const [account, setAccount] = useState<{ configured: boolean; account: Account | null }>();
  const [settingsError, setSettingsError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useDocumentTitle(person?.displayName ?? 'Person');


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
    api
      .get<SignIn[]>(`/core/sign-ins?userId=${id}&since=${from}T00:00:00Z&limit=60`)
      .then(setSignIns)
      .catch(fail('signIns'));
  }, [id, from, to]);

  /*
   * The department list and the account, which do not move when the dates do.
   *
   * Their own effect, keyed on the person alone. Folding them into the load above would
   * re-read the identity provider every time somebody nudged a date, which is a network call
   * to somebody else's system in exchange for an answer that cannot have changed.
   */
  useEffect(() => {
    api.get<Department[]>('/core/departments').then(setDepartments).catch(() => setDepartments([]));
    api
      .get<{ configured: boolean; account: Account | null }>(`/core/people/${id}/account`)
      .then(setAccount)
      .catch(() => setAccount({ configured: false, account: null }));
  }, [id]);

  /**
   * What the business knows about this person, changed where their name is.
   *
   * Role used to be a dropdown in a column of the directory table — a one-click privilege
   * change on whichever row the pointer happened to be over — while the page named after the
   * person showed every other field as static text you could not edit at all. Both are now
   * here, next to their name, which is where somebody goes when they think about a
   * colleague's contract or what they should be able to reach.
   *
   * One saver for every field. Each is a `PATCH` of the single thing that changed, so a
   * refused role does not silently take a job title down with it, and the server's own
   * refusals — demoting yourself, demoting the last administrator — arrive as sentences and
   * are shown as sentences rather than swallowed.
   */
  const save = async (patch: Partial<Person>) => {
    setSettingsError(undefined);
    setSaving(true);
    try {
      await api.patch(`/core/people/${id}`, patch);
      setPerson(await api.get<Person>(`/core/people/${id}`));
    } catch (e) {
      setSettingsError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Which departments somebody is in — the whole set, every time.
   *
   * A department decides whose inbox work lands in, so this is not decoration: a person in
   * none is a person nothing can be routed to. Sent as the complete list rather than as an
   * add or a remove, because the server takes it that way and because two clicks racing each
   * other cannot then leave a half-applied set.
   */
  const setDepartmentIds = async (ids: string[]) => {
    setSettingsError(undefined);
    setSaving(true);
    try {
      await api.put(`/core/people/${id}/departments`, { departmentIds: ids });
      setPerson(await api.get<Person>(`/core/people/${id}`));
    } catch (e) {
      setSettingsError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

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
  /* Inclusive of both ends: 1 Sept to 1 Sept is one day of expected hours, not none. */
  const rangeDays =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const expected = person?.weeklyHours ? person.weeklyHours * (rangeDays / 7) : null;
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
        tabs={
          <div className="range-filter">
            <label>
              <span className="muted">Van</span>{' '}
              <input
                type="date"
                value={from}
                max={to}
                aria-label="Van"
                onChange={(e) => setRange({ from: e.target.value, to })}
              />
            </label>
            <label>
              <span className="muted">tot</span>{' '}
              <input
                type="date"
                value={to}
                min={from}
                aria-label="Tot"
                onChange={(e) => setRange({ from, to: e.target.value })}
              />
            </label>
            {PRESETS.map((r) => (
              <button key={r.days} type="button" className="range-preset" onClick={() => preset(r.days)}>
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {/* ── Aside: who they are, and what they are on ── */}
      <Block span={4}>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Card title="The person">
            <div className="person-head">
              {person && <Avatar id={person.id} name={person.displayName} size="md" />}
              <div>
                <div className="person-name">{person?.displayName ?? '…'}</div>
                <div className="muted">{person?.email}</div>
              </div>
            </div>
            {/* Name and address are the identity provider's, and are read-only here on
                purpose: they come back from Zitadel on every sign-in, so a value edited
                here would be overwritten by the next one and look like a bug. */}
            <p className="field-hint">
              Naam en e-mailadres komen van de inlogprovider en worden hier niet bewerkt.
            </p>
          </Card>

          <Card title="Settings">
            <div className="person-settings">
              <label>
                <span>Role</span>
                <select
                  aria-label={`Role for ${person?.displayName ?? 'this person'}`}
                  value={person?.role ?? 'member'}
                  disabled={!person || saving}
                  onChange={(e) => void save({ role: e.target.value as Person['role'] })}
                >
                  <option value="member">Member</option>
                  <option value="admin">Administrator</option>
                </select>
                {/* An administrator can reach settings, cost rates and the people directory;
                    everyone else can reach the work. Said here because the two words on
                    their own do not say it. */}
                <span className="field-hint">
                  {person?.role === 'admin'
                    ? 'Can manage people, settings and cost rates.'
                    : 'Can reach the work, but not settings or cost rates.'}
                </span>
              </label>

              <label>
                <span>Job title</span>
                <input
                  type="text"
                  defaultValue={person?.jobTitle ?? ''}
                  disabled={!person || saving}
                  placeholder="Data-analist"
                  /* On blur, not on every keystroke: a PATCH per character would be a
                     write per character, and the audit log records each one. */
                  onBlur={(e) => {
                    const next = e.target.value.trim() || null;
                    if (next !== (person?.jobTitle ?? null)) void save({ jobTitle: next });
                  }}
                />
              </label>

              <label>
                <span>Started</span>
                <input
                  type="date"
                  defaultValue={person?.startedOn ?? ''}
                  disabled={!person || saving}
                  onChange={(e) => void save({ startedOn: e.target.value || null })}
                />
              </label>

              <label>
                <span>Contracted hours a week</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  step={1}
                  defaultValue={person?.weeklyHours ?? ''}
                  disabled={!person || saving}
                  /* Left empty on purpose where it is unknown. It is the denominator of the
                     utilisation figure above, and a default of forty would put a percentage
                     on a colleague's page that nobody entered. */
                  placeholder="niet ingesteld"
                  onBlur={(e) => {
                    const next = e.target.value === '' ? null : Number(e.target.value);
                    if (next !== (person?.weeklyHours ?? null)) void save({ weeklyHours: next });
                  }}
                />
              </label>

              {/* Absent, not null, when the viewer is not an admin — so this simply is not here. */}
              {person && 'costRateCents' in person && (
                <label>
                  <span>Cost rate (€ per hour)</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={person.costRateCents != null ? person.costRateCents / 100 : ''}
                    disabled={saving}
                    placeholder="niet ingesteld"
                    onBlur={(e) => {
                      const next = e.target.value === '' ? null : Math.round(Number(e.target.value) * 100);
                      if (next !== (person.costRateCents ?? null)) void save({ costRateCents: next });
                    }}
                  />
                </label>
              )}

              <label>
                <span>Status</span>
                <select
                  value={person?.isActive === false ? 'inactive' : 'active'}
                  disabled={!person || saving}
                  onChange={(e) => void save({ isActive: e.target.value === 'active' })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Deactivated</option>
                </select>
                <span className="field-hint">
                  A deactivated colleague keeps the hours and cards they already own; they
                  get no new work and cannot sign in.
                </span>
              </label>
            </div>

            {settingsError && (
              <p className="field-hint field-error" role="alert">
                {settingsError}
              </p>
            )}
          </Card>

          <Card title="Departments">
            {/* Not a role and not a permission: a department decides whose inbox an item
                lands in. Somebody in none is somebody nothing can be routed to, which is
                why the empty state says so rather than sitting blank. */}
            {departments.length === 0 ? (
              <Empty>No departments yet. Add them under Settings.</Empty>
            ) : (
              <div className="chip-set">
                {departments.map((d) => {
                  const on = person?.departmentIds?.includes(d.id) ?? false;
                  return (
                    <label key={d.id} className={on ? 'chip chip-on' : 'chip'}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!person || saving}
                        onChange={() =>
                          void setDepartmentIds(
                            on
                              ? (person?.departmentIds ?? []).filter((x) => x !== d.id)
                              : [...(person?.departmentIds ?? []), d.id],
                          )
                        }
                      />
                      {d.label}
                    </label>
                  );
                })}
              </div>
            )}
            {person?.departmentIds?.length === 0 && departments.length > 0 && (
              <p className="field-hint">
                In geen enkele afdeling — er wordt niets naar deze persoon gerouteerd.
              </p>
            )}
          </Card>

          <Card title="Login account">
            {/* The hub knows what somebody may do; the provider knows whether they can get in
                at all. Those were two applications and a search, so "why can this person not
                sign in" now has both halves in one place — read-only, with the link out for
                anything that changes it. */}
            {!account ? (
              <p className="muted">Loading…</p>
            ) : !account.configured ? (
              <Empty>The identity provider is not configured for this deployment.</Empty>
            ) : !account.account ? (
              <Empty>
                No account at the identity provider for {person?.email}. They cannot sign in yet.
              </Empty>
            ) : (
              <>
                <dl className="terms">
                  <dt>Status</dt>
                  <dd>{account.account.active ? 'Active' : 'Deactivated at the provider'}</dd>
                  <dt>Email verified</dt>
                  <dd>{account.account.emailVerified ? 'Yes' : 'No'}</dd>
                  <dt>Password set</dt>
                  {/* Never set means the invitation is still outstanding, which is the single
                      most common reason somebody cannot get in. */}
                  <dd>
                    {account.account.passwordChangedAt
                      ? account.account.passwordChangedAt.slice(0, 10)
                      : 'Never — invitation still open'}
                  </dd>
                  <dt>Sign-in name</dt>
                  <dd>{account.account.loginNames.join(', ') || '—'}</dd>
                </dl>
                <p className="field-hint">
                  <a href={account.account.consoleUrl} target="_blank" rel="noreferrer noopener">
                    Manage this account at the provider
                  </a>
                </p>
              </>
            )}
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
            title={`Hours · ${rangeLabel}`}
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
            title="When they were here"
            sub={`Sessions ${rangeLabel}`}
            loading={!signIns && !failed.signIns}
            error={failed.signIns}
          >
            {signIns?.length === 0 ? (
              <Empty>
                Nothing in this window. A row appears the first time they do something after
                half an hour away — the platform never sees a login, because the browser
                renews its own token without asking.
              </Empty>
            ) : (
              <ul className="person-activity">
                {(signIns ?? []).map((row) => (
                  <li key={row.at}>
                    <span className="person-activity-when">{WHEN.format(new Date(row.at))}</span>
                    <span>
                      {row.surface === 'portal' ? (
                        <>
                          opened the client portal of{' '}
                          <strong>{row.clientName ?? 'a client'}</strong>
                        </>
                      ) : (
                        'was working in the platform'
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="What they did"
            sub={`Every change they made ${rangeLabel}`}
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
