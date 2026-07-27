import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { ChatWidgetProps } from '../types.js';
import { money, type Quote } from './types.js';

/** A quote, as the assistant shows it. Read-only: it never sends or decides. */
export function QuoteChatCard({ id, displayName, urlPath }: ChatWidgetProps) {
  const [quote, setQuote] = useState<Quote | null>(null);

  useEffect(() => {
    api
      .get<Quote>(`/sales/quotes/${id}`)
      .then(setQuote)
      .catch(() => setQuote(null));
  }, [id]);

  return (
    <div className="chat-card">
      <div className="chat-card-head">
        <span className="badge">quote</span>
        <Link to={urlPath}>{quote?.number ?? displayName}</Link>
        {quote?.expired && <span className="badge priority-urgent">expired</span>}
      </div>
      {quote && (
        <div className="muted">
          {quote.status} · {quote.title} · {money(quote.totalCents)}
          {quote.status === 'sent' && quote.validUntil && ` · valid to ${quote.validUntil}`}
        </div>
      )}
      <div className="chat-card-actions">
        <Link to={urlPath}>open</Link>
      </div>
    </div>
  );
}
