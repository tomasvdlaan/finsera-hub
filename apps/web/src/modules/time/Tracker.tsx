import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Button, Empty } from '../../shell/ui/primitives.js';
import { elapsed, useRunningTimer } from '../../shell/useRunningTimer.js';
import { notifyTimeChanged } from '../../shell/useDocumentTitle.js';
import { formatClock, formatSpan, parseDuration, resolveTimes, todayIso } from './duration.js';

interface Project {
  id: string;
  name: string;
  clientName?: string | null;
}

interface Entry {
  id: string;
  projectId: string;
  projectName: string;
  clientName: string | null;
  description: string | null;
  /** What this entry counts as — from its own minutes, or from its start and end. */
  effectiveMinutes: number;
  startedAt: string | null;
  endedAt: string | null;
  billable: boolean;
  workedOn: string;
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
function projectHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [error, setError] = useState<string | null>(null);

  // What the clock will be started against, and what a manual entry is logged to.
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const [manualDuration, setManualDuration] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [recent, list] = await Promise.all([
        api.get<{ days: Day[] }>('/time/recent'),
        api.get<Project[]>('/crm/projects'),
      ]);
      setDays(recent.days);
      setProjects(list);
      setProjectId((current) => current || list[0]?.id || '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* The list is behind the moment a clock stops, and stopping happens from two places. */
  useEffect(() => {
    if (!running) void load();
  }, [running, load]);

  const logManually = async () => {
    if (!projectId) return;
    setSaving(true);
    setError(null);
    try {
      const minutes = manualDuration ? parseDuration(manualDuration) : null;
      if (manualDuration && minutes === null) throw new Error(`"${manualDuration}" is not a duration`);
      // 22:00–02:00 is a four-hour shift, not a negative one — resolveTimes knows that.
      const { startedAt, endedAt } = resolveTimes(todayIso(), manualStart, manualEnd);
      await api.post('/time/entries', {
        projectId,
        workedOn: todayIso(),
        startedAt,
        endedAt,
        // Times win when both are given; the clock is the evidence.
        minutes: manualStart ? undefined : minutes,
        description: description.trim() || null,
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

  const today = days.find((d) => d.date === todayIso())?.totalMinutes ?? 0;
  const week = days.reduce((sum, d) => sum + d.totalMinutes, 0);

  return (
    <>
      <h1>Time</h1>

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
              <select
                aria-label="Project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {projects.length === 0 && <option value="">No projects</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                disabled={busy || !projectId}
                onClick={() => void start(projectId, description).then(() => setDescription(''))}
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
          <select
            aria-label="Project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            className="tracker-time"
            value={manualStart}
            placeholder="09:00"
            aria-label="Start time"
            onChange={(e) => setManualStart(e.target.value)}
          />
          <span className="muted">–</span>
          <input
            className="tracker-time"
            value={manualEnd}
            placeholder="10:30"
            aria-label="End time"
            onChange={(e) => setManualEnd(e.target.value)}
          />
          <input
            className="tracker-time"
            value={manualDuration}
            placeholder="or 1h30"
            aria-label="Duration"
            onChange={(e) => setManualDuration(e.target.value)}
          />
          <Button variant="primary" disabled={saving || !projectId} onClick={() => void logManually()}>
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
          <section key={day.date} className="panel tracker-day">
            <header className="panel-head">
              <h3>{dayLabel(day.date)}</h3>
              <span className="tracker-day-total">{formatSpan(day.totalMinutes)}</span>
            </header>
            {day.entries.map((entry) => (
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
                  <Link to={`/crm/projects/${entry.projectId}`}>{entry.projectName}</Link>
                </span>
                <span className="tracker-entry-times">
                  {entry.startedAt && entry.endedAt
                    ? `${formatClock(entry.startedAt)} – ${formatClock(entry.endedAt)}`
                    : ''}
                </span>
                <span className="tracker-entry-duration">
                  {formatSpan(entry.effectiveMinutes)}
                </span>
              </div>
            ))}
          </section>
        ))
      )}

      <p className="muted">
        <Link to="/time/week">See the week by project</Link> — or open a day to correct times,
        change what is billable, or delete an entry.
      </p>
    </>
  );
}
