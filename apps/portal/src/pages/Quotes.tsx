import { api, type PortalQuote } from '../lib/api.js';
import { Listing, date, euros, useList } from './shared.js';

const STATUS: Record<string, string> = {
  sent: 'Ter beoordeling',
  accepted: 'Geaccepteerd',
  rejected: 'Afgewezen',
};

export function Quotes() {
  const { rows, error } = useList<PortalQuote>(api.quotes);

  return (
    <Listing rows={rows} error={error} empty="Er staan geen offertes open.">
      {(quotes) => (
        <table>
          <thead>
            <tr>
              <th>Nummer</th>
              <th>Omschrijving</th>
              <th>Datum</th>
              <th>Geldig tot</th>
              <th className="num">Bedrag</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id}>
                <td>{q.number}</td>
                <td>{q.title}</td>
                <td>{date(q.issue_date)}</td>
                <td>{date(q.valid_until)}</td>
                <td className="num">{euros(q.total_cents)}</td>
                <td>
                  {/* Accepting is step 4. Until then an expired quote must at least say so,
                      rather than presenting a price that is no longer on offer. */}
                  {q.expired && q.status === 'sent' ? (
                    <span className="tag overdue">Verlopen</span>
                  ) : (
                    <span className="tag">{STATUS[q.status] ?? q.status}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Listing>
  );
}
