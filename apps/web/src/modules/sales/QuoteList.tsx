import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { Client } from '../crm/types.js';
import { money, type Quote } from './types.js';
import { Empty, Status } from '../../shell/ui/primitives.js';

export function QuoteList() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [newClient, setNewClient] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = status ? `?status=${status}` : '';
    return api
      .get<Quote[]>(`/sales/quotes${q}`)
      .then(setQuotes)
      .catch((e: Error) => setError(e.message));
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<Client[]>('/crm/clients')
      .then((rows) => {
        setClients(rows);
        setNewClient((c) => c || (rows[0]?.id ?? ''));
      })
      .catch(() => setClients([]));
  }, []);

  const clientName = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!newClient || !title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const quote = await api.post<Quote>('/sales/quotes', {
        clientId: newClient,
        title: title.trim(),
        // One placeholder line so the quote is valid from the start; it is meant to be edited.
        lines: [{ description: title.trim(), quantity: '1.00', unitPriceCents: 3_500 }],
      });
      navigate(`/sales/quotes/${quote.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const open = quotes.filter((q) => q.status === 'sent');
  const openValue = open.reduce((sum, q) => sum + q.totalCents, 0);

  return (
    <>
      <PageHeader
        title="Quotes"
        subtitle="Drafts are free to change. Sending numbers the quote and freezes it, so the version a client agreed to stays exactly as they read it — changes after that are a revision."
      />

      {open.length > 0 && (
        <p>
          <strong>{money(openValue)}</strong>{' '}
          <span className="muted">
            out with {open.length} client{open.length === 1 ? '' : 's'}
            {open.some((q) => q.expired) && ' — some past their validity date'}
          </span>
        </p>
      )}

      <form onSubmit={(e) => void create(e)}>
        <div className="row">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="draft">draft</option>
            <option value="sent">sent</option>
            <option value="accepted">accepted</option>
            <option value="rejected">rejected</option>
          </select>

          <span className="muted">·</span>

          <select
            value={newClient}
            onChange={(e) => setNewClient(e.target.value)}
            aria-label="Client"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What is the quote for?"
            aria-label="Quote title"
            style={{ flex: 1, minWidth: 220 }}
          />
          <button type="submit" disabled={creating || !title.trim() || !newClient}>
            {creating ? 'Creating…' : 'New quote'}
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      {quotes.length === 0 ? (
        <Empty>No quotes yet.</Empty>
      ) : (
        <ul className="cards">
          {quotes.map((quote) => (
            <li key={quote.id}>
              <Link to={`/sales/quotes/${quote.id}`}>{quote.number ?? 'Draft'}</Link>{' '}
              <Status value={quote.status} />
              {quote.expired && <span className="badge priority-urgent">expired</span>}
              {quote.version > 1 && <span className="badge">v{quote.version}</span>}{' '}
              <span className="muted">
                {quote.title} · {clientName[quote.clientId] ?? '—'} · {money(quote.totalCents)}
                {quote.status === 'sent' && quote.validUntil && ` · valid to ${quote.validUntil}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
