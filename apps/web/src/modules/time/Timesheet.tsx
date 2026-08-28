import { useCallback, useEffect, useState } from 'react';
import { PageHeader, SubNav } from '../../shell/ui/layout.js';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Card } from '../../shell/ui/card.js';
import { Block } from '../../shell/ui/layout.js';
import { PendingApprovals, SubmitWeek } from './Approvals.js';
import { ExportHours } from './ExportHours.js';
import { useCan } from '../../shell/useCan.js';
import { shiftDay } from '../../lib/dates.js';
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
  /*
   * One counter, both blocks.
   *
   * Handing your week in changes what the approvals list should say, and approving changes what
   * the hand-in block should say — they are two views of one row. Without this, submitting left
   * the list beside it insisting nothing was waiting.
   */
  const { can } = useCan();
  const [changed, setChanged] = useState(0);
  const refresh = () => setChanged((n) => n + 1);

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



  /*
   * A page that cannot load is still a page.
   *
   * This used to return a bare line of text, which took the header, the week navigation, the
   * tab strip and the back link with it — so a slow request left somebody on a screen with no
   * way off it but the browser's back button. The header renders first and always; only the
   * grid waits.
   */
  const dayTotal = (day: string) => (week?.rows ?? []).reduce((sum, r) => sum + (r.days[day] ?? 0), 0);


  return (
    <>
      <PageHeader
        title={week ? `Week of ${week.weekOf}` : 'This week'}
        subtitle="Read-only overview. Click any day to open it and edit the entries behind it."
        tabs={<SubNav items={CLOCK} />}
        back={{ to: '/time', label: 'Back to day view' }}
      />

      <div className="row">
        <button disabled={!week} onClick={() => week && setWeekOf(shiftWeek(week.weekOf, -1))}>
          ← Previous
        </button>
        <button onClick={() => setWeekOf(undefined)}>This week</button>
        <button disabled={!week} onClick={() => week && setWeekOf(shiftWeek(week.weekOf, 1))}>
          Next →
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {!week && !error && <p className="muted">Loading…</p>}

      {week && (
        <>

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
                <td colSpan={week.days.length + 2} className="muted">
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
      )}

      {/*
        Handing the week in, and — for whoever may decide — everybody else's.

        Both sit under the grid rather than above it: you read the week, then you act on it. The
        approvals block renders nothing at all for a member, so the layout below is theirs too.
      */}
      {week && (
        <Block span={5}>
          <Card title="Hand in this week">
            <SubmitWeek weekOf={week.weekOf} refreshKey={changed} onChange={refresh} />
          </Card>
        </Block>
      )}
      <Block span={7}>
        <Card title="Waiting on a decision">
          <PendingApprovals refreshKey={changed} onChange={refresh} />
        </Card>
      </Block>

      {/*
        Out of the platform.
        
        Whose hours depends on who is asking: an admin exports the team's week, everybody else
        exports their own. The server decides either way — this only picks the default.
      */}
      {week && (
        <Block span={12}>
          <Card
            title="Export these hours"
            sub={can('time.entries.read_all') ? 'Everybody, for this week' : 'Your hours, for this week'}
          >
            <ExportHours
              from={week.weekOf}
              to={shiftDay(week.weekOf, 6)}
              personId={can('time.entries.read_all') ? 'all' : undefined}
            />
          </Card>
        </Block>
      )}
    </>
  );
}
