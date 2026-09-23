import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Empty } from '../../shell/ui/primitives.js';

interface Row {
  id: string;
  subject: string;
  status: 'waiting_on_finsera' | 'waiting_on_client' | 'closed';
  client_id: string;
  last_activity_at: string;
  days_waiting: number | null;
}

const STATUS: Record<Row['status'], string> = {
  waiting_on_finsera: 'waiting on us',
  waiting_on_client: 'waiting on them',
  closed: 'closed',
};

const day = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso));

/**
 * This client's open tickets, on this client's page.
 *
 * The inbox at `/portal/tickets` answers "who is waiting" across everybody, which is the
 * triage question. This answers the other one — "what has this client asked us" — while
 * you are already looking at them, and it is the question you have with their name on the
 * screen rather than the one you have at the start of the day.
 *
 * Filtered client-side from the same endpoint the inbox uses, deliberately: the endpoint
 * already returns every open ticket with its client, a per-client route would be a second
 * query with the same authorisation to get right, and the whole list is a few dozen rows.
 * If that ever stops being true, this is where the per-client route belongs.
 */
export function ClientTicketsWidget({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<Row[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .get<Row[]>('/portal-preview/tickets?status=open')
      .then((all) => setRows(all.filter((t) => t.client_id === clientId)))
      // Not an error worth a red line on somebody else's page: a colleague without
      // `portal.tickets` simply has nothing to see here.
      .catch((err: Error) => setError(err.message));
  }, [clientId]);

  if (error) return <p className="muted">Tickets are not available to you.</p>;
  if (!rows) return <p className="muted">Loading…</p>;
  if (rows.length === 0) return <Empty>No open tickets.</Empty>;

  return (
    <ul className="plain">
      {rows.map((t) => (
        <li key={t.id} style={{ marginBottom: '.5rem' }}>
          <Link to={`/portal/tickets/${t.id}`}>{t.subject}</Link>
          <div className="muted">
            {STATUS[t.status]} · {day(t.last_activity_at)}
            {t.days_waiting != null && t.days_waiting >= 2 && ` · ${t.days_waiting} days`}
          </div>
        </li>
      ))}
    </ul>
  );
}
