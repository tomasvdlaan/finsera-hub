import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  formatClock,
  formatHours,
  parseDuration,
  resolveTimes,
  spansMidnight,
  toClockValue,
} from './duration.js';

export interface Entry {
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

export interface Project {
  id: string;
  name: string;
}

/**
 * One time entry, switching between display and edit.
 *
 * Everything is editable — project, date, both clock times, duration, note, billability.
 * Hours get corrected constantly (wrong project, forgot to stop a timer, logged on the
 * wrong day), so an entry you cannot amend is an entry people work around.
 */
export function EntryRow({
  entry,
  projects,
  locked,
  onSave,
  onStop,
  onDelete,
}: {
  entry: Entry;
  projects: Project[];
  locked: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onStop: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectId, setProjectId] = useState(entry.projectId);
  const [workedOn, setWorkedOn] = useState(entry.workedOn);
  const [start, setStart] = useState(toClockValue(entry.startedAt));
  const [end, setEnd] = useState(toClockValue(entry.endedAt));
  const [duration, setDuration] = useState(
    entry.minutes != null ? formatHours(entry.minutes) : '',
  );
  const [description, setDescription] = useState(entry.description ?? '');
  const [billable, setBillable] = useState(entry.billable);

  const reset = () => {
    setProjectId(entry.projectId);
    setWorkedOn(entry.workedOn);
    setStart(toClockValue(entry.startedAt));
    setEnd(toClockValue(entry.endedAt));
    setDuration(entry.minutes != null ? formatHours(entry.minutes) : '');
    setDescription(entry.description ?? '');
    setBillable(entry.billable);
    setError(null);
    setEditing(false);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Handles a shift crossing midnight: an end at or before the start belongs to the
      // next day, so 22:00–02:00 is four hours rather than an error.
      const { startedAt, endedAt } = resolveTimes(workedOn, start, end);
      const minutes = duration ? parseDuration(duration) : null;
      if (duration && minutes === null) throw new Error(`"${duration}" is not a duration`);

      await onSave({
        projectId,
        workedOn,
        startedAt,
        endedAt,
        // Times win when present — the clock is the evidence.
        minutes: start ? undefined : minutes,
        description: description.trim() || null,
        billable,
      });
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <li className={entry.running ? 'running' : undefined}>
        <div className="entry-main">
          <div>
            <Link to={`/crm/projects/${entry.projectId}`}>{entry.projectName}</Link>
            {entry.clientName && <span className="muted"> · {entry.clientName}</span>}
          </div>
          {entry.description && <div>{entry.description}</div>}
          <span className="muted">
            {entry.startedAt ? formatClock(entry.startedAt) : '—'}
            {' → '}
            {entry.endedAt ? formatClock(entry.endedAt) : entry.running ? 'running' : '—'}
            {spansMidnight(entry.startedAt, entry.endedAt) && (
              <span className="badge" title="Ends the next day">
                +1
              </span>
            )}
          </span>
        </div>

        <div className="entry-side">
          <strong>{formatHours(entry.effectiveMinutes)}h</strong>
          {!entry.billable && <span className="badge">internal</span>}
          {entry.running && (
            <button onClick={() => void onStop()} disabled={locked}>
              Stop
            </button>
          )}
          <button className="link-button" onClick={() => setEditing(true)} disabled={locked}>
            edit
          </button>
          <button className="link-button" onClick={() => void onDelete()} disabled={locked}>
            delete
          </button>
        </div>
      </li>
    );
  }

  return (
    <li>
      <form onSubmit={(e) => void save(e)} style={{ width: '100%' }}>
        <div className="row">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={workedOn}
            onChange={(e) => setWorkedOn(e.target.value)}
            aria-label="Date"
          />
        </div>

        <div className="row">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What did you work on?"
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
            placeholder="1.5 / 1:30 / 90m"
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

        {error && <p className="error">{error}</p>}

        <div className="row">
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="link-button" onClick={reset}>
            cancel
          </button>
          {entry.running && (
            <span className="muted">Clearing the end time keeps this running.</span>
          )}
        </div>
      </form>
    </li>
  );
}
