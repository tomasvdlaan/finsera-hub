import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useShared } from '../../lib/useShared.js';
import { subjectPath, type Insight } from './Insights.js';

/**
 * The one thing on the page that is a decision rather than a reading.
 *
 * Everything else on a dashboard reports; this asks. That difference deserves a different
 * shape, and it is the shape the rest of the grid does not have: full width, tinted, its own
 * type scale, and buttons that do something rather than an arrow that navigates.
 *
 * One at a time, deliberately. A list of nine things needing a decision is a list you scroll
 * past — the whole value of a queue is that it shows you the front of it and hides the rest,
 * so the question is "deal with this or skip it" rather than "which of these nine".
 *
 * Ranked by what it costs to wait rather than by severity or age. Age alone puts a stale
 * nice-to-have above a client who is deciding on Monday, and severity alone cannot tell those
 * apart either. See `cost` below for what that actually means, since the honest version is
 * cruder than the phrase suggests.
 */
function cost(i: Insight): number {
  /*
   * A rough ordering, and no pretence otherwise.
   *
   * There is no model of money-per-day-of-delay in this system and inventing one would be
   * exactly the kind of authoritative fiction the rest of this codebase refuses. What exists
   * is severity and magnitude, so: urgent outranks attention, and within a severity the bigger
   * magnitude goes first. The heading says "ranked by what it costs to wait" because that is
   * what the ordering is *for*; this comment is here so nobody later mistakes it for a
   * calculation.
   */
  return (i.severity === 'urgent' ? 1_000_000 : 0) + (i.magnitude ?? 0);
}

export function DecisionQueue() {
  const { data, loading } = useShared<Insight[]>('/insights?status=open');
  const [at, setAt] = useState(0);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const queue = (data ?? [])
    .filter((i) => i.severity === 'urgent' || i.severity === 'attention')
    .filter((i) => !dismissed.includes(i.id))
    .sort((a, b) => cost(b) - cost(a));

  if (loading) return <div className="hero" data-span={12} aria-busy="true" />;
  if (queue.length === 0) {
    return (
      <div className="hero hero-clear" data-span={12}>
        <div className="hero-chrome">
          <span>Needs a decision</span>
        </div>
        <p className="hero-clear-line">Nothing is waiting on a decision from you.</p>
      </div>
    );
  }

  // Clamped rather than wrapped: the queue shrinks as you deal with it, and an index that
  // wrapped round would put you back at the top without saying so.
  const index = Math.min(at, queue.length - 1);
  const item = queue[index];
  if (!item) return null;
  const path = subjectPath(item);

  const skip = () => setAt((n) => (n + 1) % queue.length);
  const drop = () => {
    void api.post(`/insights/${item.id}/dismiss`, {}).catch(() => undefined);
    // Removed locally straight away. The sweep that produced it runs every six hours, so
    // waiting for a refetch would leave the dismissed item on screen for the rest of the day.
    setDismissed((all) => [...all, item.id]);
    setAt(0);
  };

  return (
    <div className="hero" data-span={12} data-urgent={item.severity === 'urgent' || undefined}>
      <div className="hero-chrome">
        <span>Needs a decision</span>
        <span className="hero-steps" aria-hidden="true">
          {queue.map((q, n) => (
            <i key={q.id} data-on={n === index || undefined} />
          ))}
        </span>
        <span className="hero-count">
          {index + 1} of {queue.length} · ranked by what it costs to wait
        </span>
        <button type="button" onClick={skip} aria-label="Next decision" disabled={queue.length < 2}>
          →
        </button>
      </div>

      <div className="hero-body">
        <div>
          <h2>{item.title}</h2>
          {item.detail && <p>{item.detail}</p>}
          <div className="hero-actions">
            {path && (
              <Link to={path} className="hero-go">
                Open it
              </Link>
            )}
            <button type="button" onClick={drop} className="hero-second">
              Dismiss
            </button>
            <button type="button" onClick={skip} className="hero-third" disabled={queue.length < 2}>
              Later
            </button>
          </div>
        </div>

        {queue.length > 1 && (
          <aside className="hero-next">
            <span className="card-meta">Next in the queue</span>
            <ul>
              {queue
                .filter((_, n) => n !== index)
                .slice(0, 2)
                .map((q, n) => (
                  <li key={q.id}>
                    <b>{n + 2}</b>
                    <span>
                      {q.title}
                      {q.detail && <small>{q.detail}</small>}
                    </span>
                  </li>
                ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
