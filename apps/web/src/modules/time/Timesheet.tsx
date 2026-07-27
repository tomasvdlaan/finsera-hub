import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  DAY_LABELS,
  formatDayHeader,
  formatDuration,
  formatHours,
  isToday,
  isWeekend,
  parseDuration,
  shiftWeek,
} from './duration.js';

interface Row {
  id: string;
  name: string;
  clientId: string | null;
  days: Record<string, number>;
}

interface Week {
  weekOf: string;
  days: string[];
  rows: Row[];
  totalMinutes: number;
  billableMinutes: number;
  submitted: boolean;
}

interface Project {
  id: string;
  name: string;
  clientId: string;
}

/**
 * The week grid — the screen the whole phase is designed around.
 *
 * The constraint (master doc): logging a day takes under a minute. Everything here
 * serves it — no Save button (saves on blur), no modal, no page transition, rows
 * carried over from last week, and Tab/Enter navigation so hands stay on the keyboard.
 */
export function Timesheet() {
  const [week, setWeek] = useState<Week | null>(null);
  const [weekOf, setWeekOf] = useState<string | undefined>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<HTMLTableElement>(null);

  const load = useCallback(async () => {
    const q = weekOf ? `?weekOf=${weekOf}` : '';
    try {
      const data = await api.get<Week>(`/time/week${q}`);
      setWeek(data);
      setWeekOf(data.weekOf);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [weekOf]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<Project[]>('/crm/projects')
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  /** Saves on blur. A Save button would be one more action per day, every day. */
  const commit = async (
    projectId: string,
    day: string,
    input: HTMLInputElement,
    previous: number,
  ) => {
    const raw = input.value;
    const minutes = parseDuration(raw);
    if (minutes === null) {
      setError(`"${raw}" is not a duration — try 7.5, 7:30 or 90m`);
      input.value = formatDuration(previous); // put the cell back to the stored value
      return;
    }
    if (minutes === previous) return;

    setSaving(true);
    setError(null);
    try {
      await api.post('/time/cell', { projectId, workedOn: day, minutes });
      // Show the canonical form of what was actually stored: type "7:30", see "7.5".
      // The cells are uncontrolled, so a reload alone would leave the raw text.
      input.value = formatDuration(minutes);
      await load();
    } catch (e) {
      setError((e as Error).message);
      input.value = formatDuration(previous);
      await load();
    } finally {
      setSaving(false);
    }
  };

  /** Enter moves down a row, keeping the same day — the way a week is actually filled. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, dayIndex: number) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = gridRef.current?.querySelectorAll<HTMLInputElement>('input[data-cell]');
    if (!inputs) return;
    const perRow = week?.days.length ?? 7;
    const next = inputs[(rowIndex + 1) * perRow + dayIndex];
    (next ?? inputs[dayIndex])?.focus();
  };

  const addRow = async (projectId: string) => {
    if (!projectId || !week) return;
    // An empty row is local until something is typed into it — no phantom entries.
    setWeek({
      ...week,
      rows: [
        ...week.rows,
        {
          id: projectId,
          name: projects.find((p) => p.id === projectId)?.name ?? 'Project',
          clientId: null,
          days: Object.fromEntries(week.days.map((d) => [d, 0])),
        },
      ],
    });
    setAdding('');
  };

  const submit = async () => {
    if (!week) return;
    try {
      await api.post('/time/submit', { weekOf: week.weekOf });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reopen = async () => {
    if (!week) return;
    try {
      await api.post('/time/reopen', { weekOf: week.weekOf });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!week) return <p className="muted">{error ?? 'Loading…'}</p>;

  const unusedProjects = projects.filter((p) => !week.rows.some((r) => r.id === p.id));
  const dayTotal = (day: string) => week.rows.reduce((sum, r) => sum + (r.days[day] ?? 0), 0);

  return (
    <>
      <h1>Timesheet</h1>

      <div className="row">
        <button onClick={() => setWeekOf(shiftWeek(week.weekOf, -1))}>← Previous</button>
        <strong>Week of {week.weekOf}</strong>
        <button onClick={() => setWeekOf(shiftWeek(week.weekOf, 1))}>Next →</button>
        <button onClick={() => setWeekOf(undefined)}>This week</button>
        {saving && <span className="muted">saving…</span>}
      </div>

      {week.submitted && (
        <p className="muted">
          <span className="badge">submitted</span> This week is locked.{' '}
          <button className="link-button" onClick={() => void reopen()}>
            reopen
          </button>
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <div className="grid-scroll">
      <table className="grid" ref={gridRef}>
        <thead>
          <tr>
            <th>Project</th>
            {week.days.map((d, i) => (
              <th key={d} className={isWeekend(i) ? 'weekend' : isToday(d) ? 'today' : undefined}>
                {DAY_LABELS[i]}
                <br />
                <span className="muted">{formatDayHeader(d)}</span>
              </th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {week.rows.map((row, rowIndex) => (
            <tr key={row.id}>
              <th scope="row">
                <Link to={`/crm/projects/${row.id}`}>{row.name}</Link>
              </th>
              {week.days.map((day, dayIndex) => (
                <td key={day} className={isWeekend(dayIndex) ? 'weekend' : undefined}>
                  <input
                    data-cell
                    defaultValue={formatDuration(row.days[day] ?? 0)}
                    disabled={week.submitted}
                    aria-label={`${row.name} on ${day}`}
                    onBlur={(e) => void commit(row.id, day, e.target, row.days[day] ?? 0)}
                    onKeyDown={(e) => onKeyDown(e, rowIndex, dayIndex)}
                  />
                </td>
              ))}
              <td className="total">
                {formatHours(Object.values(row.days).reduce((a, b) => a + b, 0))}
              </td>
            </tr>
          ))}
          {week.rows.length === 0 && (
            <tr>
              <td colSpan={9} className="muted">
                No projects yet — add one below.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {week.days.map((d, i) => (
              <td key={d} className={`total ${isWeekend(i) ? 'weekend' : ''}`}>
                {formatHours(dayTotal(d))}
              </td>
            ))}
            <td className="total">{formatHours(week.totalMinutes)}</td>
          </tr>
        </tfoot>
      </table>
      </div>

      <div className="row">
        <select
          value={adding}
          onChange={(e) => void addRow(e.target.value)}
          disabled={week.submitted}
          aria-label="Add project row"
        >
          <option value="">Add project row…</option>
          {unusedProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {!week.submitted && week.totalMinutes > 0 && (
          <button onClick={() => void submit()}>Submit week</button>
        )}
      </div>

      <p className="muted">
        {formatHours(week.billableMinutes)}h billable of {formatHours(week.totalMinutes)}h logged. Type <code>7.5</code>, <code>7:30</code> or <code>90m</code> — Tab moves across
        days, Enter down to the next project.
      </p>
    </>
  );
}
