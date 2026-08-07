import { useCallback, useEffect, useState } from 'react';
import { PageHeader, SubNav } from '../../shell/ui/layout.js';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  DAY_LABELS,
  formatDayHeader,
  formatHours,
  isToday,
  isWeekend,
  shiftWeek,
} from './duration.js';

interface Row {
  id: string;
  name: string;
  clientName: string | null;
  days: Record<string, number>;
}

interface Week {
  weekOf: string;
  days: string[];
  rows: Row[];
  totalMinutes: number;
  billableMinutes: number;
}

/**
 * Week overview — read-only.
 *
 * Entries carry start/end times and notes now, so one cell can hold several of them and
 * cannot be edited as a single number. This screen answers "where did the week go, and
 * where are the gaps"; editing happens in the day view, one click from any cell.
 */
/** The clock and the week it adds up to. Two readings of the same hours. */
const CLOCK = [
  { label: 'Tracker', to: '/time' },
  { label: 'This week', to: '/time/week' },
];

export function Timesheet() {
  const [week, setWeek] = useState<Week | null>(null);
  const [weekOf, setWeekOf] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

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



  if (!week) return <p className="muted">{error ?? 'Loading…'}</p>;

  const dayTotal = (day: string) => week.rows.reduce((sum, r) => sum + (r.days[day] ?? 0), 0);

  return (
    <>
      <PageHeader
        title={`Week of ${week.weekOf}`}
        subtitle="Read-only overview. Click any day to open it and edit the entries behind it."
        tabs={<SubNav items={CLOCK} />}
        back={{ to: '/time', label: 'Back to day view' }}
      />

      <div className="row">
        <button onClick={() => setWeekOf(shiftWeek(week.weekOf, -1))}>← Previous</button>
        <button onClick={() => setWeekOf(undefined)}>This week</button>
        <button onClick={() => setWeekOf(shiftWeek(week.weekOf, 1))}>Next →</button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="grid-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>Project</th>
              {week.days.map((d, i) => (
                <th key={d} className={isWeekend(i) ? 'weekend' : isToday(d) ? 'today' : undefined}>
                  {/* Every column is a way into the day it represents. */}
                  <Link to={`/time?date=${d}`}>
                    {DAY_LABELS[i]}
                    <br />
                    <span className="muted">{formatDayHeader(d)}</span>
                  </Link>
                </th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {week.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <Link to={`/projects/${row.id}`}>{row.name}</Link>
                  {row.clientName && <div className="muted">{row.clientName}</div>}
                </th>
                {week.days.map((day, i) => (
                  <td key={day} className={isWeekend(i) ? 'weekend' : undefined}>
                    {row.days[day] ? (
                      <Link to={`/time?date=${day}`}>{formatHours(row.days[day]!)}</Link>
                    ) : (
                      <span className="muted">·</span>
                    )}
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
                  Nothing logged this week.
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

      <p className="muted">
        {formatHours(week.billableMinutes)}h billable of {formatHours(week.totalMinutes)}h logged.
      </p>
    </>
  );
}
