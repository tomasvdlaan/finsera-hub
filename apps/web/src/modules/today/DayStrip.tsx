import { Link } from 'react-router-dom';
import { useShared } from '../../lib/useShared.js';

interface Task {
  flow: 'queue' | 'active' | 'waiting' | 'done';
  dueOn: string | null;
  daysInColumn: number;
}

/**
 * The running totals, in the page header rather than in four cards.
 *
 * Four counters at three columns each is a third of the first screen spent on four integers,
 * and the four integers are the least interesting things on the page — they say nothing you
 * would act on, only whether there is anything to act on. Inline they cost one line and still
 * answer that.
 *
 * They are deliberately not removable. Everything below is the person's own arrangement; this
 * is the frame, and a dashboard where the frame is also configurable has no shape at all.
 */
export function DayStrip() {
  const tasks = useShared<Task[]>('/scrum/tasks');
  const today = new Date().toISOString().slice(0, 10);
  const all = tasks.data ?? [];

  const doing = all.filter((t) => t.flow === 'active').length;
  const waiting = all.filter((t) => t.flow === 'waiting');
  const overdue = all.filter((t) => t.dueOn && t.dueOn < today).length;
  const oldest = waiting.reduce((n, t) => Math.max(n, t.daysInColumn ?? 0), 0);

  if (tasks.loading) return null;

  return (
    <div className="daystrip">
      <Link to="/work">
        <span>In progress</span>
        <b>{doing}</b>
      </Link>
      <Link to="/work" data-warn={oldest >= 7 || undefined}>
        <span>Waiting</span>
        <b>{waiting.length}</b>
        {oldest > 0 && <em>{oldest}d</em>}
      </Link>
      {/* Zero stays quiet. A clean board rendered in the alarming colour looks exactly as bad
          as a late one, which is how a signal stops being one. */}
      <Link to="/work" data-alarm={overdue > 0 || undefined}>
        <span>Overdue</span>
        <b>{overdue}</b>
      </Link>
    </div>
  );
}
