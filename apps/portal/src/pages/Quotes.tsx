import { useEffect, useState } from 'react';
import { useViewer } from '../App.js';
import { api, type PortalQuote, type PortalQuoteLine } from '../lib/api.js';
import { Listing, date, euros, useList } from './shared.js';

const STATUS: Record<string, string> = {
  sent: 'Ter beoordeling',
  accepted: 'Geaccepteerd',
  rejected: 'Afgewezen',
};

/** Units are stored in English; a client-facing page in Dutch should not show that. */
const UNIT: Record<string, string> = { hours: 'uur', days: 'dagen', fixed: 'vast' };

/** The lines, fetched only when someone opens a quote — nobody needs all of them at once. */
function Lines({ quoteId }: { quoteId: string }) {
  const [lines, setLines] = useState<PortalQuoteLine[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    api
      .quoteLines(quoteId)
      .then((l) => live && setLines(l))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [quoteId]);

  if (error) return <p className="error">{error}</p>;
  if (!lines) return <p className="tag">Bezig…</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>Omschrijving</th>
          <th className="num">Aantal</th>
          <th className="num">Prijs</th>
          <th className="num">Bedrag</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td>{l.description}</td>
            <td className="num">
              {l.quantity} {l.unit ? (UNIT[l.unit] ?? l.unit) : ''}
            </td>
            <td className="num">{euros(l.unit_price_cents)}</td>
            <td className="num">{euros(l.amount_cents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Quotes() {
  const { rows, error } = useList<PortalQuote>(api.quotes);
  // Accepting is a statement by the client about a price, so an employee looking at their
  // portal is not offered it. The server refuses it too, whatever this decides.
  const { staff } = useViewer();
  const [open, setOpen] = useState<string>();
  const [accepting, setAccepting] = useState<string>();
  // Which quote is awaiting confirmation. Deliberately not `window.confirm`: this app
  // runs in embedded browsers that suppress native dialogs, and a suppressed dialog makes
  // the button silently do nothing — which is how the meeting attendee button failed.
  const [confirming, setConfirming] = useState<string>();
  const [accepted, setAccepted] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string>();

  const accept = (quote: PortalQuote) => {
    setFailed(undefined);
    setAccepting(quote.id);
    api
      .acceptQuote(quote.id)
      .then((r) => {
        setAccepted((a) => ({ ...a, [quote.id]: r.status }));
        setConfirming(undefined);
      })
      .catch((err: Error) => setFailed(`${quote.number}: ${err.message}`))
      .finally(() => setAccepting(undefined));
  };

  return (
    <Listing rows={rows} error={error} empty="Er staan geen offertes open.">
      {(quotes) => (
        <>
          {failed && <p className="error">{failed}</p>}
          <table>
            <thead>
              <tr>
                <th>Nummer</th>
                <th>Omschrijving</th>
                <th>Geldig tot</th>
                <th className="num">Bedrag</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const status = accepted[q.id] ?? q.status;
                const expired = q.expired && status === 'sent';
                return (
                  <tr key={q.id}>
                    <td>
                      <button
                        className="link"
                        onClick={() => setOpen(open === q.id ? undefined : q.id)}
                      >
                        {q.number}
                      </button>
                      {open === q.id && <Lines quoteId={q.id} />}
                    </td>
                    <td>{q.title}</td>
                    <td>{date(q.valid_until)}</td>
                    <td className="num">{euros(q.total_cents)}</td>
                    <td>
                      {expired ? (
                        <span className="tag overdue">Verlopen</span>
                      ) : (
                        <span className="tag">{STATUS[status] ?? status}</span>
                      )}
                    </td>
                    <td className="num">
                      {/* Only an open, unexpired quote offers the button. The server checks
                          both again — this decides what to show, not what is allowed. */}
                      {status === 'sent' &&
                        !expired &&
                        !staff &&
                        (confirming === q.id ? (
                          // Two steps, because this is the one action that commits the
                          // client to a price. The amount is repeated so what is being
                          // agreed to is on screen at the moment of agreeing.
                          <span>
                            <span className="tag">Akkoord met {euros(q.total_cents)}?</span>{' '}
                            <button onClick={() => accept(q)} disabled={accepting === q.id}>
                              {accepting === q.id ? 'Bezig…' : 'Ja, accepteren'}
                            </button>{' '}
                            <button className="link" onClick={() => setConfirming(undefined)}>
                              annuleren
                            </button>
                          </span>
                        ) : (
                          <button onClick={() => setConfirming(q.id)}>Accepteren</button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </Listing>
  );
}
