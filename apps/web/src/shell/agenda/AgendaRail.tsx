import { Link } from 'react-router-dom';
import { Card } from '../ui/card.js';
import { Empty } from '../ui/primitives.js';
import { daysBetween } from '../../lib/dates.js';
import { upcoming, type AgendaItem } from './agendaItems.js';

/**
 * What is coming, beside the week rather than inside it.
 *
 * The grid answers "what does Thursday look like". This answers the different question the
 * grid cannot: what is closing in, regardless of which week it lands in. Ranked by urgency
 * before date, because a chronological list puts the thing that is three weeks late below the
 * thing that is due tomorrow.
 */

const KIND_LABEL: Record<string, string> = {
  task: 'Card',
  action: 'Action point',
  invoice: 'Invoice',
  quote: 'Quote',
  meeting: 'Meeting',
};

/** How far off, in words. "In 3 days" reads faster than a date you have to subtract from today. */
function when(at: string, today: string): string {
  const days = daysBetween(today, at);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

export function AgendaRail({
  items,
  today,
  loading,
  failed,
}: {
  items: AgendaItem[];
  today: string;
  loading: boolean;
  failed: Array<{ key: string; label: string; error?: string }>;
}) {
  const rows = upcoming(items, today);
  const late = rows.filter((r) => r.tone === 'danger').length;

  return (
    <>
      <Card
        title="Closing in"
        sub={late > 0 ? `${late} already past` : 'Nothing is late'}
        span={12}
        tone={late > 0 ? 'danger' : undefined}
        loading={loading && rows.length === 0}
      >
        {rows.length === 0 ? (
          <Empty>
            Nothing with a date on it in the next fortnight. Deadlines on cards, action points,
            invoices and quotes all land here.
          </Empty>
        ) : (
          <ul className="agenda-due">
            {rows.slice(0, 12).map((r) => (
              <li key={r.id} data-tone={r.tone}>
                <div className="agenda-due-main">
                  {r.href ? <Link to={r.href}>{r.title}</Link> : <span>{r.title}</span>}
                  <span className="agenda-due-kind">{KIND_LABEL[r.kind] ?? r.kind}</span>
                </div>
                <div className="agenda-due-meta">
                  <span className="agenda-due-when">{when(r.at, today)}</span>
                  {r.detail && <span className="agenda-due-detail">{r.detail}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/*
        A source that failed says so, by name.

        Seven independent reads means a partial agenda is a normal state, and a page that
        quietly draws six of seven is the confidently-wrong kind of broken: the week looks
        complete and the invoices are simply missing from it.
      */}
      {failed.length > 0 && (
        <Card title="Not everything loaded" span={12} tone="warning">
          <ul className="agenda-failed">
            {failed.map((f) => (
              <li key={f.key}>
                <b>{f.label}</b>
                <span className="muted">{f.error}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
