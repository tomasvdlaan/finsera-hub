import { Fragment, useEffect, useState } from 'react';
import { useViewer } from '../App.js';
import { api, type PortalQuote, type PortalQuoteLine } from '../lib/api.js';
import { Card, Listing, Page, date, euros, useList } from './shared.js';

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
    <Page title="Offertes" lead="Wat we voorstellen, wat het kost, en wat u ervan vindt.">
      <Listing rows={rows} error={error} empty="Er staan geen offertes open.">
        {(quotes) => (
          <>
            {failed && <p className="error">{failed}</p>}
            <Card>
              <table>
            <thead>
              <tr>
                <th>Nummer</th>
                <th>Omschrijving</th>
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
                  /*
                   * The lines get a row of their own, spanning the table.
                   *
                   * They used to render inside the number cell, which is the narrowest
                   * column on the widest screen — four columns of money folded into about
                   * ninety pixels. What they are is a breakdown of the row above, so that
                   * is where they belong: underneath it, across the full width.
                   */
                  <Fragment key={q.id}>
                  <tr>
                    <td className="nowrap">
                      <button
                        className="link"
                        onClick={() => setOpen(open === q.id ? undefined : q.id)}
                      >
                        {q.number}
                      </button>
                    </td>
                    <td>
                      {q.title}
                      {/* Validity belongs to the quote rather than to a column of its own:
                          six columns squeezed the description into four wrapped lines, and
                          a date nobody scans down a column reads better beneath it. */}
                      {q.valid_until && (
                        <span className="meta">Geldig tot {date(q.valid_until)}</span>
                      )}
                    </td>
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
                      {status === 'sent' && !expired && !staff && confirming !== q.id && (
                        <button onClick={() => setConfirming(q.id)}>Accepteren</button>
                      )}
                    </td>
                  </tr>
                  {confirming === q.id && (
                    /*
                     * Two steps, and the second one gets a row to itself.
                     *
                     * This is the only place a client commits to a price, and it was three
                     * controls crammed into the narrowest cell of a scrolling table — half
                     * of it off the edge on a laptop. Across the full width there is room
                     * to repeat the amount at a size somebody actually reads before
                     * agreeing to it.
                     */
                    <tr className="confirm">
                      <td colSpan={5}>
                        <div>
                          <p>
                            Akkoord met <strong>{euros(q.total_cents)}</strong> voor{' '}
                            {q.title}?
                          </p>
                          <div className="row">
                            <button
                              className="primary"
                              onClick={() => accept(q)}
                              disabled={accepting === q.id}
                            >
                              {accepting === q.id ? 'Bezig…' : 'Ja, accepteren'}
                            </button>
                            <button className="link" onClick={() => setConfirming(undefined)}>
                              annuleren
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {open === q.id && (
                    <tr className="lines">
                      <td colSpan={5}>
                        <Lines quoteId={q.id} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
              </table>
            </Card>
          </>
        )}
      </Listing>
    </Page>
  );
}
