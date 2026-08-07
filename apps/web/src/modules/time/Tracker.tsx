import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Badge, Button, Empty } from '../../shell/ui/primitives.js';
import { elapsed, useRunningTimer } from '../../shell/useRunningTimer.js';
import { notifyTimeChanged } from '../../shell/useDocumentTitle.js';
import {
  formatClock,
  formatDuration,
  formatSpan,
  parseDuration,
  toLocalInput,
  todayIso,
} from './duration.js';
import { TargetPicker, type Target } from './TargetPicker.js';
import { Icon } from '../../shell/Icon.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useToast } from '../../shell/ui/Toast.js';

interface Project {
  id: string;
  name: string;
  clientName?: string | null;
}

interface Entry {
  id: string;
  projectId: string | null;
  /** Set when the hour is against a client with no project yet. */
  clientId: string | null;
  /** The raw column: null for an entry timed by its start and end. */
  minutes: number | null;
  projectName: string;
  clientName: string | null;
  description: string | null;
  /** What this entry counts as — from its own minutes, or from its start and end. */
  effectiveMinutes: number;
  startedAt: string | null;
  endedAt: string | null;
  billable: boolean;
  workedOn: string;
  running: boolean;
  /**
   * unbilled → billable and not yet on anything. on_draft → sitting on a draft invoice.
   * invoiced → issued, and therefore frozen: the server refuses to change these at all.
   */
  billingStatus: 'not_billable' | 'unbilled' | 'on_draft' | 'invoiced';
}

interface Day {
  date: string;
  entries: Entry[];
  totalMinutes: number;
}

/**
 * A colour per project, derived rather than stored.
 *
 * The dot beside an entry only has to be *consistent* — the same project the same colour
 * down the page — so hashing the id gets that for nothing and survives a project being
 * renamed. Storing a colour would mean a picker, a migration and a way to choose two that
 * look alike.
 */
/**
 * A stable colour per target.
 *
 * Takes null now that an hour can be against a client, or against nothing at all — internal
 * work has no project id and used to crash this. Null gets its own fixed hue rather than a
 * derived one, so every internal hour shares a colour and reads as one thing.
 */
/** Whether either time in the draft differs from the value the field was handed. */
function timesChanged(
  entry: { startedAt: string | null; endedAt: string | null },
  draft: { startedAt: string; endedAt: string },
): boolean {
  return (
    draft.startedAt !== toLocalInput(entry.startedAt) ||
    draft.endedAt !== toLocalInput(entry.endedAt)
  );
}

function projectHue(id: string | null): number {
  if (!id) return 220;
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

const BILLING_LABEL: Record<Entry['billingStatus'], string> = {
  not_billable: 'Not billable',
  unbilled: 'Billable',
  on_draft: 'On a draft invoice',
  invoiced: 'Invoiced',
};

/**
 * The billing state of one entry, and the switch for it where there still is one.
 *
 * Four states, three of which are ordinary and one of which is final. Once hours are on an
 * issued invoice they cannot be altered — so this shows the badge alone rather than a control
 * that would be refused, and says why on hover.
 */
function BillingControl({
  entry,
  onChange,
}: {
  entry: Entry;
  onChange: (entry: Entry, next: boolean) => void;
}) {
  if (entry.billingStatus === 'invoiced' || entry.billingStatus === 'on_draft') {
    return (
      <Badge tone={entry.billingStatus === 'invoiced' ? 'ok' : 'warning'}
        title={
          entry.billingStatus === 'invoiced'
            ? 'On an issued invoice — credit the invoice to change these hours'
            : 'On a draft invoice'
        }
      >
        {BILLING_LABEL[entry.billingStatus]}
      </Badge>
    );
  }

  return (
    <label className="tracker-billable" title={BILLING_LABEL[entry.billingStatus]}>
      <input
        type="checkbox"
        checked={entry.billable}
        aria-label={`Billable — ${entry.description ?? 'entry'}`}
        onChange={(e) => onChange(entry, e.target.checked)}
      />
      <span className="tracker-billable-text">{entry.billable ? 'Billable' : 'Not billable'}</span>
    </label>
  );
}

const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  if (iso === todayIso()) return 'Today';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

/**
 * The tracker.
 *
 * One screen for the three things anyone does with time: run a clock, write down the hour
 * you forgot to run one for, and look at what you have already logged. It replaced a page
 * that showed a single day and made you step through dates to see the one before it — which
 * is the wrong shape for a question that is nearly always "what have I been doing lately".
 *
 * The clock is the same one as in the rail. `useRunningTimer` owns the polling and the stop,
 * so the two cannot disagree about whether something is running, and starting here shows up
 * there within the second.
 */
export function Tracker() {
  const { running, forgotten, busy, error: timerError, start, stop } = useRunningTimer();
  const { confirm } = useDialog();
  const toast = useToast();
  /** Which entry is open for correction, and the draft being corrected. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    description: string;
    startedAt: string;
    endedAt: string;
    /** For an entry logged as a length rather than a span — "1h30", the way it was entered. */
    duration: string;
    target: Target;
    billable: boolean;
  } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [error, setError] = useState<string | null>(null);

  // What the clock will be started against, and what a manual entry is logged to.
  const [target, setTarget] = useState<Target>({});
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [description, setDescription] = useState('');
  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const [manualDuration, setManualDuration] = useState('');
  const [billable, setBillable] = useState(false);
  const [saving, setSaving] = useState(false);
  /*
   * Re-renders once a second while something is running.
   *
   * Today's figure has to move — it is the number you glance at to decide whether to stop —
   * and the server can only tell you what it was when you asked.
   */
  const [, setTick] = useState(0);

  /*
   * `?date=` asks for a particular day.
   *
   * Every time entry in core.entities points here — an hour has no page of its own, it is
   * read in its day — and `/time/recent` is a fixed window that an entry from three weeks
   * ago falls outside of. So a date in the query widens the window back to it, and the day
   * it names is marked. Without this the link resolves and shows you the wrong week, which
   * is a worse failure than "not found" because nothing tells you it happened.
   */
  const asked = new URLSearchParams(useLocation().search).get('date');

  /*
   * A ref callback rather than an effect: the day arrives with the data, so there is no
   * render at which "the element exists and I have not scrolled to it yet" is observable
   * from an effect without also re-scrolling on every subsequent render.
   */
  const scrolled = useRef<string | null>(null);
  const scrollTo = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !asked || scrolled.current === asked) return;
      scrolled.current = asked;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    [asked],
  );

  const load = useCallback(async () => {
    try {
      const [recent, list, clientList] = await Promise.all([
        api.get<{ days: Day[] }>(asked ? `/time/recent?from=${asked}` : '/time/recent'),
        api.get<Project[]>('/crm/projects'),
        api.get<Array<{ id: string; name: string }>>('/crm/clients'),
      ]);
      setDays(recent.days);
      setProjects(list);
      setClients(clientList);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [asked]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The list is behind the moment a clock stops, and stopping happens from two places. */
  useEffect(() => {
    if (!running) void load();
  }, [running, load]);

  useEffect(() => {
    if (!running) return;
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(clock);
  }, [running]);

  const logManually = async () => {
    setSaving(true);
    setError(null);
    try {
      const minutes = manualDuration ? parseDuration(manualDuration) : null;
      if (manualDuration && minutes === null) throw new Error(`"${manualDuration}" is not a duration`);
      if (!manualStart && minutes === null) throw new Error('Give a start and end, or a duration');

      /*
       * Full instants, not times against an assumed day.
       *
       * The fields were `09:00`–`10:30` and the entry was filed under today, so an hour
       * worked last Thursday could not be entered at all without going to the day view and
       * changing the date first. A shift that runs past midnight is also two dates, and no
       * amount of cleverness recovers the second one from a bare clock time.
       */
      await api.post('/time/entries', {
        ...target,
        // The day an entry belongs to is the day it started, which the browser gives us.
        workedOn: manualStart ? manualStart.slice(0, 10) : todayIso(),
        startedAt: manualStart ? new Date(manualStart).toISOString() : null,
        endedAt: manualEnd ? new Date(manualEnd).toISOString() : null,
        // Times win when both are given; the clock is the evidence.
        minutes: manualStart && manualEnd ? undefined : minutes,
        description: description.trim() || null,
        billable,
      });
      setDescription('');
      setManualStart('');
      setManualEnd('');
      setManualDuration('');
      notifyTimeChanged();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /** Change whether an entry is billable. Refused by the server once it has been invoiced. */
  /*
   * Correcting an hour, where the hour is.
   *
   * These endpoints have existed since the module did, and the tracker's own footer told you
   * to go to the day view to use them — so fixing a typo meant leaving the page you record
   * on. The day view keeps working; this is the same three verbs where they are wanted.
   */
  const beginEdit = (entry: Entry) => {
    setRowError(null);
    setEditing(entry.id);
    setDraft({
      description: entry.description ?? '',
      startedAt: toLocalInput(entry.startedAt),
      endedAt: toLocalInput(entry.endedAt),
      // Blank when the entry has a span: the times are the truth there, and offering both
      // would be two controls for one number with no rule about which wins.
      duration: entry.startedAt ? '' : formatDuration(entry.effectiveMinutes),
      target: { projectId: entry.projectId, clientId: entry.clientId },
      billable: entry.billable,
    });
  };

  const saveEdit = async (entry: Entry) => {
    if (!draft) return;
    setRowError(null);
    try {
      await api.patch(`/time/entries/${entry.id}`, {
        description: draft.description.trim() || null,
        // Both ids together: the server clears the other one, and sending only the new half
        // would leave a row that fails its own check constraint.
        projectId: draft.target.projectId ?? null,
        clientId: draft.target.clientId ?? null,
        billable: draft.billable,
        /*
         * Times only when they were actually changed.
         *
         * A `datetime-local` field has minute precision, so an entry that started at 23:43:51
         * comes back as 23:43 — and saving a row where only the description was corrected
         * would silently shave fifty-one seconds off it. Comparing against what the field was
         * given means an untouched time is not sent at all.
         */
        ...(timesChanged(entry, draft)
          ? {
              startedAt: draft.startedAt ? new Date(draft.startedAt).toISOString() : null,
              endedAt: draft.endedAt ? new Date(draft.endedAt).toISOString() : null,
              workedOn: draft.startedAt ? draft.startedAt.slice(0, 10) : entry.workedOn,
            }
          : /*
             * An entry logged as a length is corrected as a length.
             *
             * Only when it has no span — an entry with a start and an end gets its duration
             * from them, and letting both be edited would be two controls for one number
             * with no rule about which wins.
             */
            !entry.startedAt && draft.duration.trim()
            ? { minutes: parseDuration(draft.duration) }
            : {}),
      });
      setEditing(null);
      setDraft(null);
      await load();
      notifyTimeChanged();
    } catch (e) {
      // Beside the fields being corrected, not at the top of a page nobody is looking at.
      setRowError((e as Error).message);
    }
  };

  /**
   * Delete, with a way back.
   *
   * An hour is small enough that a confirmation dialog for every one would be a nuisance, and
   * valuable enough that losing one silently is not acceptable — so it goes immediately and
   * the toast offers to put it back. Recreated rather than un-deleted, because the row is
   * gone; what returns is an identical entry, which is what was wanted.
   */
  const removeEntry = async (entry: Entry) => {
    try {
      await api.del(`/time/entries/${entry.id}`);
      await load();
      notifyTimeChanged();
      toast.ok('Entry deleted', {
        undo: async () => {
          await api.post('/time/entries', {
            projectId: entry.projectId,
            clientId: entry.clientId,
            workedOn: entry.workedOn,
            minutes: entry.minutes ?? entry.effectiveMinutes,
            startedAt: entry.startedAt,
            endedAt: entry.endedAt,
            description: entry.description,
            billable: entry.billable,
          });
          await load();
          notifyTimeChanged();
        },
      });
    } catch (e) {
      setRowError((e as Error).message);
    }
  };

  /** Pick this up again — the same work, timed from now. */
  const continueEntry = async (entry: Entry) => {
    setRowError(null);
    try {
      await start({ projectId: entry.projectId, clientId: entry.clientId }, entry.description ?? '');
      await load();
    } catch (e) {
      setRowError((e as Error).message);
    }
  };

  const setEntryBillable = async (entry: Entry, next: boolean) => {
    setError(null);
    try {
      await api.patch(`/time/entries/${entry.id}`, { billable: next });
      notifyTimeChanged();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /*
   * Today, counting the clock that is still running.
   *
   * The server's total already includes a running entry, but frozen at the moment it was
   * asked — so the figure sat still while the clock beside it moved. The stored entries are
   * summed without the running one and its live elapsed is added back, which keeps the two
   * numbers on this screen telling the same story second by second.
   */
  const liveMinutes = running
    ? Math.max(0, Math.floor((Date.now() - new Date(running.startedAt).getTime()) / 60_000))
    : 0;
  const runningToday = running?.workedOn === todayIso();
  const settled = (day: Day | undefined) =>
    (day?.entries ?? []).filter((e) => !e.running).reduce((sum, e) => sum + e.effectiveMinutes, 0);

  const today = settled(days.find((d) => d.date === todayIso())) + (runningToday ? liveMinutes : 0);
  const week =
    days.reduce((sum, d) => sum + settled(d), 0) + liveMinutes;

  return (
    <>
      <PageHeader title="Time" />

      <div className="tracker-top">
        {/*
          The clock, and everything it needs to be started.

          A timer you cannot label is a timer that produces entries called nothing, which is
          the state most timesheets are found in — so the description and the project sit on
          the same row as the button rather than being something you fix afterwards.
        */}
        <div className={forgotten ? 'tracker-clock tracker-warn' : 'tracker-clock'}>
          <span className={running ? 'timer-dot' : 'timer-dot timer-dot-idle'} aria-hidden="true" />
          <span className="tracker-elapsed" aria-live="polite">
            {running ? elapsed(running.startedAt) : '0:00:00'}
          </span>

          {running ? (
            <>
              <span className="tracker-running-what">
                {running.description ?? <span className="muted">No description</span>}
              </span>
              <span className="tag">{running.projectName}</span>
              <Button variant="danger" disabled={busy} onClick={() => void stop()}>
                {busy ? 'Stopping…' : 'Stop'}
              </Button>
            </>
          ) : (
            <>
              <input
                className="tracker-what"
                value={description}
                placeholder="What are you working on?"
                aria-label="What are you working on?"
                onChange={(e) => setDescription(e.target.value)}
              />
              <TargetPicker
                value={target}
                projects={projects}
                clients={clients}
                onChange={setTarget}
                label="What is this against?"
              />
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void start(target, description).then(() => setDescription(''))}
              >
                {busy ? 'Starting…' : 'Start'}
              </Button>
            </>
          )}
        </div>

        {/* Where the week stands, next to the clock that is adding to it. */}
        <div className="tracker-totals">
          <div>
            <div className="stat-label">Today</div>
            <div className="stat-value">{formatSpan(today)}</div>
          </div>
          <div>
            <div className="stat-label">Last 14 days</div>
            <div className="stat-value">{formatSpan(week)}</div>
          </div>
        </div>
      </div>

      <section className="panel">
        <header className="panel-head">
          <h2>Add an entry</h2>
          <span className="muted">for work you did without the clock running</span>
        </header>
        <div className="tracker-manual">
          <input
            value={description}
            placeholder="What did you work on?"
            aria-label="What did you work on?"
            onChange={(e) => setDescription(e.target.value)}
          />
          <TargetPicker
            value={target}
            projects={projects}
            clients={clients}
            onChange={setTarget}
          />
          {/* Full instants. A shift that runs past midnight is two dates, and a bare clock
              time cannot express the second one. */}
          <input
            type="datetime-local"
            className="tracker-when"
            value={manualStart}
            aria-label="Started at"
            onChange={(e) => setManualStart(e.target.value)}
          />
          <span className="muted">–</span>
          <input
            type="datetime-local"
            className="tracker-when"
            value={manualEnd}
            aria-label="Ended at"
            onChange={(e) => setManualEnd(e.target.value)}
          />
          <input
            className="tracker-time"
            value={manualDuration}
            placeholder="or 1h30"
            aria-label="Duration"
            disabled={Boolean(manualStart && manualEnd)}
            title={manualStart && manualEnd ? 'Taken from the times above' : undefined}
            onChange={(e) => setManualDuration(e.target.value)}
          />
          <label className="tracker-billable">
            <input
              type="checkbox"
              checked={billable}
              onChange={(e) => setBillable(e.target.checked)}
            />
            Billable
          </label>
          <Button variant="primary" disabled={saving} onClick={() => void logManually()}>
            {saving ? 'Logging…' : 'Log'}
          </Button>
        </div>
      </section>

      {(error || timerError) && <p className="error">{error ?? timerError}</p>}

      <h2 className="tracker-recent-head">Recent activity</h2>
      {days.length === 0 ? (
        <Empty>
          Nothing logged in the last fortnight. Start the clock above, or write down an hour
          you already worked.
        </Empty>
      ) : (
        days.map((day) => (
          <section
            key={day.date}
            className="panel tracker-day"
            data-asked={day.date === asked || undefined}
            // Scrolled to rather than paged to: the days around it are the context that makes
            // one day's hours readable, and a page showing one day is what this replaced.
            ref={day.date === asked ? scrollTo : undefined}
          >
            <header className="panel-head">
              <h3>{dayLabel(day.date)}</h3>
              <span className="tracker-day-total">{formatSpan(day.totalMinutes)}</span>
            </header>
            {day.entries.map((entry) =>
              editing === entry.id && draft ? (
                /*
                 * The row becomes the form.
                 *
                 * In place rather than in a dialog: an hour is corrected in the context of the
                 * hours either side of it — "that started when the last one ended" — and a
                 * modal hides exactly the rows you are checking it against.
                 */
                <div key={entry.id} className="tracker-entry is-editing">
                  <input
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="What were you doing?"
                    aria-label="Description"
                    className="edit-what"
                  />
                  <TargetPicker
                    value={draft.target}
                    projects={projects}
                    clients={clients}
                    onChange={(t) => setDraft({ ...draft, target: t })}
                  />
                  <input
                    type="datetime-local"
                    value={draft.startedAt}
                    onChange={(e) => setDraft({ ...draft, startedAt: e.target.value })}
                    aria-label="Started at"
                  />
                  <input
                    type="datetime-local"
                    value={draft.endedAt}
                    onChange={(e) => setDraft({ ...draft, endedAt: e.target.value })}
                    aria-label="Ended at"
                  />
                  {/* Only for an entry that never had a span — see saveEdit. */}
                  {!entry.startedAt && (
                    <input
                      value={draft.duration}
                      onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
                      placeholder="1h30"
                      aria-label="Duration"
                      className="edit-duration"
                    />
                  )}
                  <label className="edit-billable">
                    <input
                      type="checkbox"
                      checked={draft.billable}
                      onChange={(e) => setDraft({ ...draft, billable: e.target.checked })}
                    />
                    Billable
                  </label>
                  <span className="entry-actions">
                    <Button size="sm" variant="primary" onClick={() => void saveEdit(entry)}>
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(null);
                        setDraft(null);
                        setRowError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </span>
                  {rowError && <span className="error edit-error">{rowError}</span>}
                </div>
              ) : (
                <div key={entry.id} className="tracker-entry">
                  <span className="tracker-entry-what">
                    {entry.description || <span className="muted">No description</span>}
                  </span>
                  <span className="tracker-entry-project">
                    <span
                      className="tracker-dot"
                      style={{ background: `hsl(${projectHue(entry.projectId)} 55% 50%)` }}
                      aria-hidden="true"
                    />
                    {entry.projectId ? (
                      <Link to={`/projects/${entry.projectId}`}>{entry.projectName}</Link>
                    ) : (
                      <span className="muted">{entry.projectName}</span>
                    )}
                  </span>
                  <span className="tracker-entry-times">
                    {entry.startedAt && entry.endedAt
                      ? `${formatClock(entry.startedAt)} – ${formatClock(entry.endedAt)}`
                      : ''}
                  </span>
                  {/*
                    Whether this hour can still be sold, and whether it already has been.

                    Invoiced hours are frozen — the server refuses to change them and says to
                    credit the invoice first — so the control is disabled rather than offered
                    and then rejected.
                  */}
                  <BillingControl entry={entry} onChange={setEntryBillable} />
                  <span className="tracker-entry-duration">
                    {formatSpan(entry.effectiveMinutes)}
                  </span>

                  {/*
                    Three verbs, as glyphs, appearing on approach.

                    Invoiced hours cannot be edited or deleted — the server refuses — so those
                    two are disabled and say why rather than failing after the click.
                    Continuing one is always fine: it starts a new entry, and touches nothing
                    that was invoiced.
                  */}
                  <span className="entry-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      title={running ? 'A timer is already running' : 'Continue this work'}
                      aria-label={`Continue ${entry.description ?? 'this entry'}`}
                      disabled={Boolean(running) || busy}
                      onClick={() => void continueEntry(entry)}
                    >
                      <Icon name="clock" size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title={
                        entry.billingStatus === 'invoiced'
                          ? 'On an issued invoice — credit the invoice first'
                          : 'Edit'
                      }
                      aria-label={`Edit ${entry.description ?? 'this entry'}`}
                      disabled={entry.billingStatus === 'invoiced' || entry.running}
                      onClick={() => beginEdit(entry)}
                    >
                      <Icon name="pencil" size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn is-danger"
                      title={
                        entry.billingStatus === 'invoiced'
                          ? 'On an issued invoice — credit the invoice first'
                          : 'Delete'
                      }
                      aria-label={`Delete ${entry.description ?? 'this entry'}`}
                      disabled={entry.billingStatus === 'invoiced' || entry.running}
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Delete this entry?',
                          body: `${formatSpan(entry.effectiveMinutes)} on ${entry.projectName}. You can undo it straight after.`,
                          confirmLabel: 'Delete',
                          destructive: true,
                        });
                        if (ok) await removeEntry(entry);
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </span>
                </div>
              ),
            )}
          </section>
        ))
      )}

      <p className="muted">
        <Link to="/time/week">See the week by project</Link>. Hover an entry to continue,
        correct or delete it.
      </p>
    </>
  );
}
