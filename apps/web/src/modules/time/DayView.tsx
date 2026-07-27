import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatClock, formatHours, parseDuration, shiftDay, todayIso } from './duration.js';

interface Entry {
  id: string;
  projectId: string;
  projectName: string;
  clientName: string | null;
  workedOn: string;
  startedAt: string | null;
  endedAt: string | null;
  minutes: number | null;
  effectiveMinutes: number;
  running: boolean;
  billable: boolean;
  description: string | null;
}

interface Day {
  date: string;
  entries: Entry[];
  totalMinutes: number;
  billableMinutes: number;
  submitted: boolean;
}

interface Project {
  id: string;
  name: string;
}

/**
 * The day view — the primary entry screen.
 *
 * Each entry carries optional start/end times and a note. An entry with a start but no
 * end IS the running timer: there is no separate timer concept to keep in sync.
 */
export function DayView() {
  const [date, setDate] = useState(todayIso());
  const [day, setDay] = useState<Day | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Only used to force a re-render so a running timer's elapsed time stays current.
  const [, setTick] = useState(0);

  // form
  const [projectId, setProjectId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [duration, setDuration] = useState('');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDay(await api.get<Day>(`/time/day?date=${date}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<Project[]>('/crm/projects')
      .then((ps) => {
        setProjects(ps);
        setProjectId((cur) => cur || (ps[0]?.id ?? ''));
      })
      .catch(() => setProjects([]));
  }, []);

  // A running timer must visibly tick, or you cannot tell it is running.
  const hasRunning = day?.entries.some((e) => e.running) ?? false;
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [hasRunning]);

  const iso = (clock: string) => (clock ? `${date}T${clock}:00` : null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const minutes = duration ? parseDuration(duration) : null;
      if (duration && minutes === null) throw new Error(`"${duration}" is not a duration`);
      await api.post('/time/entries', {
        projectId,
        workedOn: date,
        startedAt: iso(start),
        endedAt: iso(end),
        // Times win when both are given; the clock is the evidence.
        minutes: start ? undefined : minutes,
        description: description.trim() || null,
        billable,
      });
      setStart('');
      setEnd('');
      setDuration('');
      setDescription('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Start now: an entry with a start and no end. */
  const startTimer = async () => {
    if (!projectId) return;
    setError(null);
    try {
      await api.post('/time/entries', {
        projectId,
        workedOn: date,
        startedAt: new Date().toISOString(),
        description: description.trim() || null,
        billable,
      });
      setDescription('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const stop = async (id: string) => {
    try {
      await api.post(`/time/entries/${id}/stop`, {});
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.del(`/time/entries/${id}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      await api.patch(`/time/entries/${id}`, body);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!day) return <p className="muted">{error ?? 'Loading…'}</p>;

  return (
    <>
      <h1>Time — {day.date}</h1>

      <div className="row">
        <button onClick={() => setDate(shiftDay(date, -1))}>← Previous day</button>
        <button onClick={() => setDate(todayIso())}>Today</button>
        <button onClick={() => setDate(shiftDay(date, 1))}>Next day →</button>
        <Link to="/time/week">Week overview</Link>
      </div>

      {day.submitted && (
        <p className="muted">
          <span className="badge">submitted</span> This week is locked.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {day.entries.length === 0 ? (
        <p className="muted">Nothing logged yet.</p>
      ) : (
        <ul className="entries">
          {day.entries.map((e) => (
            <li key={e.id} className={e.running ? 'running' : undefined}>
              <div className="entry-main">
                <Link to={`/crm/projects/${e.projectId}`}>{e.projectName}</Link>
                {e.clientName && <span className="muted"> · {e.clientName}</span>}
                {e.description && <div>{e.description}</div>}
                <span className="muted">
                  {e.startedAt ? formatClock(e.startedAt) : '—'}
                  {' → '}
                  {e.endedAt ? formatClock(e.endedAt) : e.running ? 'running' : '—'}
                </span>
              </div>

              <div className="entry-side">
                <strong>{formatHours(e.effectiveMinutes)}h</strong>
                {!e.billable && <span className="badge">non-billable</span>}
                {e.running ? (
                  <button onClick={() => void stop(e.id)}>Stop</button>
                ) : (
                  <button
                    className="link-button"
                    onClick={() => void patch(e.id, { billable: !e.billable })}
                  >
                    {e.billable ? 'mark internal' : 'mark billable'}
                  </button>
                )}
                {!day.submitted && (
                  <button className="link-button" onClick={() => void remove(e.id)}>
                    delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="muted">
        {formatHours(day.billableMinutes)}h billable of {formatHours(day.totalMinutes)}h logged
      </p>

      {!day.submitted && (
        <section>
          <h2>Add time</h2>
          <form onSubmit={(e) => void add(e)}>
            <div className="row">
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                aria-label="Project"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What did you work on? (optional)"
                aria-label="Description"
                style={{ flex: 1, minWidth: 220 }}
              />
            </div>

            <div className="row">
              <label className="muted">
                From{' '}
                <input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  aria-label="Start time"
                />
              </label>
              <label className="muted">
                to{' '}
                <input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  aria-label="End time"
                />
              </label>
              <span className="muted">or</span>
              <input
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="duration (1.5, 1:30, 90m)"
                aria-label="Duration"
                disabled={!!start}
              />
              <label className="muted">
                <input
                  type="checkbox"
                  checked={billable}
                  onChange={(e) => setBillable(e.target.checked)}
                />{' '}
                billable
              </label>
            </div>

            <div className="row">
              <button type="submit" disabled={busy || (!start && !duration)}>
                Add entry
              </button>
              <button type="button" onClick={() => void startTimer()} disabled={busy}>
                Start timer now
              </button>
              <span className="muted">
                Leaving the end time empty starts a running timer.
              </span>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
