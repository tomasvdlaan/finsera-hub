import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PageHeader, SubNav } from '../../shell/ui/layout.js';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Badge, Button, Empty } from '../../shell/ui/primitives.js';
import { Card } from '../../shell/ui/card.js';
import { Rhythm } from '../../shell/ui/viz.js';
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

/**
 * A stable colour per target, derived rather than stored.
 *
 * The dot beside an entry only has to be *consistent* — the same project the same colour down
 * the page — so hashing the id gets that for nothing and survives a rename. Storing a colour
 * would mean a picker, a migration and a way to choose two that look alike.
 *
 * Takes null because an hour can be against a client, or against nothing at all: internal work
 * has no project id. Null gets one fixed hue rather than a derived one, so every internal hour
 * shares a colour and reads as one thing.
 */
function projectTone(id: string | null): string {
  return `hsl(${projectHue(id)} 55% 50%)`;
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
  const { running, forgotten, needsDuration, busy, error: timerError, start, stop } =
    useRunningTimer();
  /*
   * How long the forgotten clock was really worked.
   *
   * A clock running over a day cannot be saved as elapsed — the entry would exceed the day
   * the column allows — so stopping it means saying what it was worth. Asking is the only
   * honest option: capping it at 24h would invent sixteen hours of work, and leaving it
   * running (which is what the failed stop used to do) keeps growing the number.
   */
  const [stopDuration, setStopDuration] = useState('');
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
   * Which way in is showing.
   *
   * The clock is first because it is the one that has to be reached without thinking — an
   * hour written down later is an hour you already noticed, and the one you did not notice is
   * the one this page exists to catch.
   */
  const [mode, setMode] = useState<'clock' | 'manual'>('clock');
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

  /*
   * Everything below is arithmetic over the entries already on screen.
   *
   * No extra request, and nothing here is an opinion: each finding names the count it found,
   * so the rail can be checked against the list beside it.
   */
  const entries = days.flatMap((d) => d.entries);
  const billableMinutes = entries
    .filter((e) => e.billable)
    .reduce((n, e) => n + e.effectiveMinutes, 0);
  const billablePct = week > 0 ? Math.round((billableMinutes / week) * 100) : 0;
  const workedDays = days.filter((d) => settled(d) > 0).length;

  /** The fortnight as fourteen bars, including the days with nothing — those are the finding. */
  const fortnight = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const date = d.toISOString().slice(0, 10);
    return { date, value: (days.find((x) => x.date === date)?.totalMinutes ?? 0) / 60 };
  });

  const byProject = [
    ...entries
      .reduce((m, e) => {
        const key = e.projectName;
        const at = m.get(key) ?? {
          name: key,
          projectId: e.projectId,
          clientName: e.clientName,
          minutes: 0,
        };
        at.minutes += e.effectiveMinutes;
        m.set(key, at);
        return m;
      }, new Map<string, { name: string; projectId: string | null; clientName: string | null; minutes: number }>())
      .values(),
  ].sort((a, b) => b.minutes - a.minutes);

  /** The last three distinct things worked on, for the one-click continue. */
  const recentTargets = [
    ...entries
      .reduce((m, e) => {
        const key = `${e.projectId ?? e.clientId}|${e.description ?? ''}`;
        const at = m.get(key) ?? {
          key,
          projectId: e.projectId,
          clientId: e.clientId,
          projectName: e.projectName,
          description: e.description,
          minutes: 0,
        };
        at.minutes += e.effectiveMinutes;
        m.set(key, at);
        return m;
      }, new Map<string, { key: string; projectId: string | null; clientId: string | null; projectName: string; description: string | null; minutes: number }>())
      .values(),
  ].slice(0, 3);

  const unnamed = entries.filter((e) => e.billable && !e.description);
  const clientless = byProject.filter((p) => !p.clientName && p.minutes > 0);
  type Finding = { key: string; text: string; action?: ReactNode };
  const findings: Finding[] = ([
    unnamed.length > 0
      ? {
          key: 'unnamed',
          text: `${unnamed.length} billable ${unnamed.length === 1 ? 'entry has' : 'entries have'} no description — an invoice built from ${unnamed.length === 1 ? 'it' : 'them'} would show blank lines.`,
          // Opens the first one for correction, which is where the fix actually happens. Not a
          // bulk action: a description is a sentence about one hour, and one written for four
          // at once is the blank line in a better disguise.
          action: (
            <button type="button" className="act" onClick={() => beginEdit(unnamed[0]!)}>
              Name the first
            </button>
          ),
        }
      : null,
    clientless.length > 0
      ? {
          key: 'clientless',
          text: `${clientless.map((p) => p.name).join(', ')} ${clientless.length === 1 ? 'has' : 'have'} no client, so those hours cannot reach an invoice.`,
          action: clientless[0]?.projectId ? (
            <Link className="act" to={`/projects/${clientless[0].projectId}`}>
              Attach one
            </Link>
          ) : undefined,
        }
      : null,
    workedDays < 3 && week > 0
      ? {
          key: 'sparse',
          text: `Only ${workedDays} of the last 14 days have any time on them. Anything not written down within a day or two is usually not written down at all.`,
        }
      : null,
  ] as Array<Finding | null>).filter((f): f is Finding => f !== null);

  return (
    <>
      <PageHeader
        title="Time"
        tabs={
          <SubNav
            items={[
              { label: 'Tracker', to: '/time' },
              { label: 'This week', to: '/time/week' },
            ]}
          />
        }
        /*
         * The totals move into the header.
         *
         * They were a pair of tiles beside the clock, which put the three numbers you glance
         * at in the same visual weight as the control you use. In the header they cost one
         * line and stay visible while you scroll the list they summarise.
         */
        meta={
          <div className="daystrip">
            <span>
              <span>Today</span>
              <b>{formatSpan(today)}</b>
            </span>
            <span>
              <span>Last 14 days</span>
              <b>{formatSpan(week)}</b>
            </span>
            {/* Only where there are hours to take a percentage of. A billable share of nought
                hours is 0%, which reads as a bad week rather than an empty one. */}
            {week > 0 && (
              <span data-warn={billablePct < 60 || undefined}>
                <span>Billable</span>
                <b>{billablePct}%</b>
              </span>
            )}
          </div>
        }
      />

      {/*
        One composer, two ways in.

        Running a clock and writing down an hour you forgot were two separate blocks stacked
        down the page — a panel with its own heading sitting under the clock, so the page
        opened with two competing controls and you read both to find the one you wanted. They
        are the same act with a different tense, so they are two tabs on one card.
      */}
      <div className="composer" data-span={12}>
        <div className="composer-tabs" role="tablist">
          {(['clock', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'composer-tab active' : 'composer-tab'}
              onClick={() => setMode(m)}
            >
              {m === 'clock' ? 'Run a clock' : 'Write down an hour'}
            </button>
          ))}
        </div>

        {mode === 'clock' ? (
        <>
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
              {needsDuration ? (
                <>
                  <input
                    className="tracker-what"
                    value={stopDuration}
                    placeholder="How long did you work? e.g. 2h30"
                    aria-label="Hours actually worked"
                    onChange={(e) => setStopDuration(e.target.value)}
                  />
                  <Button
                    variant="danger"
                    /*
                     * Zero is as invalid as unparseable, and only one of them was checked.
                     *
                     * `parseDuration('')` answers 0 rather than null — deliberate, because a
                     * blank timesheet cell means no hours. Here it meant the button stayed live
                     * on an empty field, posted `{minutes: 0}`, and came back "Minutes must be a
                     * positive whole number" — an error about the wrong thing, on the one screen
                     * whose whole job is unsticking a clock you cannot otherwise stop.
                     */
                    disabled={busy || !(parseDuration(stopDuration) ?? 0)}
                    onClick={() => {
                      const minutes = parseDuration(stopDuration);
                      if (!minutes) return;
                      // The list refreshes itself once nothing is running; the catch is only
                      // so a refused stop stays on screen as a message rather than a rejection.
                      void stop(minutes)
                        .then(() => setStopDuration(''))
                        .catch(() => {});
                    }}
                  >
                    {busy ? 'Stopping…' : 'Stop and log'}
                  </Button>
                </>
              ) : (
                <Button variant="danger" disabled={busy} onClick={() => void stop().catch(() => {})}>
                  {busy ? 'Stopping…' : 'Stop'}
                </Button>
              )}
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
        {needsDuration && running && (
          /*
           * Said in the open, because the field appearing without a reason reads as the form
           * being broken — which is what the failing stop already felt like.
           */
          <p className="tracker-overrun">
            This clock has been running since {new Date(running.startedAt).toLocaleString()},
            which is longer than a single entry can be. Say how long you actually worked and it
            will be logged from that start time.
          </p>
        )}
        </>
        ) : (
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
        )}

        {/*
          The things you were last working on, as one click each.

          Starting a clock means naming the work and picking the target again every time, and
          most of the time both are the same as yesterday. These are the last three distinct
          targets, so the common case is one click and the form is for the uncommon one.
        */}
        {!running && recentTargets.length > 0 && (
          <div className="composer-continue">
            <span className="card-meta">Continue</span>
            {recentTargets.map((t) => (
              <button
                key={t.key}
                type="button"
                className="continue-chip"
                onClick={() =>
                  void start(
                    t.projectId ? { projectId: t.projectId } : { clientId: t.clientId },
                    t.description ?? undefined,
                  )
                }
              >
                <i style={{ background: projectTone(t.projectId) }} aria-hidden="true" />
                {t.description || t.projectName}
                <small>{formatSpan(t.minutes)}</small>
              </button>
            ))}
          </div>
        )}
      </div>

      {(error || timerError) && <p className="error">{error ?? timerError}</p>}

      <div className="tracker-body" data-span={12}>
        <div className="tracker-activity">
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
                    {entry.description || (
                      <>
                        {/*
                          An unnamed hour is named here, not somewhere else.

                          "No description" was a grey label stating a fact and offering nothing,
                          on the row where the fix belongs. A billable one becomes an invoice
                          line the client reads, so the prompt is only as loud as the
                          consequence: an unnamed internal hour is untidy, an unnamed billable
                          hour is a blank line on a bill.
                        */}
                        <em className="tracker-unnamed">Untitled entry</em>
                        <button
                          type="button"
                          className="act tracker-name-it"
                          data-billable={entry.billable || undefined}
                          onClick={() => beginEdit(entry)}
                        >
                          Add a name
                        </button>
                      </>
                    )}
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

        </div>

        <aside className="tracker-rail">
          <Card title="Last 14 days" sub={`Logged on ${workedDays} of 14 days`}>
            <div className="card-fill">
              <Rhythm days={fortnight} />
            </div>
          </Card>

          {/*
            What is wrong with the hours you have, in the order it costs you.

            Every finding is computed from the entries on screen and names the number it found,
            so nothing here is advice — it is arithmetic. An empty list is the good case and
            says so rather than disappearing, because a card that vanishes when it is happy
            teaches you not to look for it.
          */}
          <Card title="Worth fixing" tone={findings.length > 0 ? 'warning' : undefined}>
            {findings.length === 0 ? (
              <Empty>Every hour has a description, a target and a client.</Empty>
            ) : (
              <ul className="fixlist">
                {findings.map((f) => (
                  <li key={f.key}>
                    <span>{f.text}</span>
                    {f.action}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="By project" sub={`${byProject.length} in the last fortnight`}>
            {byProject.length === 0 ? (
              <Empty>Nothing logged yet.</Empty>
            ) : (
              <ul className="byproject">
                {byProject.map((p) => (
                  <li key={p.name}>
                    <span className="byproject-head">
                      <b>{p.name}</b>
                      <span>{formatSpan(p.minutes)}</span>
                    </span>
                    <span className="byproject-bar">
                      <i
                        style={{
                          width: `${Math.round((p.minutes / (byProject[0]?.minutes || 1)) * 100)}%`,
                          background: projectTone(p.projectId),
                        }}
                      />
                    </span>
                    {/* An hour against a project with no client cannot reach an invoice, and
                        that is worth saying beside the hours rather than at billing time. */}
                    {!p.clientName && <small className="card-meta">No client — not invoiceable</small>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
