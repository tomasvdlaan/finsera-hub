import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { money, type Quote } from './types.js';
import { Status } from '../../shell/ui/primitives.js';

/** Quotes for one client — contributed to CRM's client page through the manifest. */
export function ClientQuotesWidget({ clientId }: { clientId: string }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);

  useEffect(() => {
    api
      .get<Quote[]>(`/sales/quotes?clientId=${clientId}`)
      .then(setQuotes)
      .catch(() => setQuotes([]));
  }, [clientId]);

  if (quotes.length === 0) {
    return (
      <p className="muted">
        No quotes yet — <Link to="/sales">open quotes</Link>.
      </p>
    );
  }

  const out = quotes.filter((q) => q.status === 'sent');
  const won = quotes.filter((q) => q.status === 'accepted');

  return (
    <div>
      <p className="muted">
        {out.length > 0 && (
          <>
            <strong>{money(out.reduce((s, q) => s + q.totalCents, 0))}</strong> awaiting a
            decision
          </>
        )}
        {out.length > 0 && won.length > 0 && ' · '}
        {won.length > 0 && `${won.length} won`}
      </p>
      <ul className="cards">
        {quotes.slice(0, 6).map((quote) => (
          <li key={quote.id}>
            <Link to={`/sales/quotes/${quote.id}`}>{quote.number ?? 'Draft'}</Link>{' '}
            <Status value={quote.status} />
            {quote.expired && <span className="badge priority-urgent">expired</span>}{' '}
            <span className="muted">
              {quote.title} · {money(quote.totalCents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
