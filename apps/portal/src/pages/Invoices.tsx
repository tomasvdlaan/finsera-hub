import { api, openFile, type PortalInvoice } from '../lib/api.js';
import { Card, Listing, Page, date, euros, useList } from './shared.js';

export function Invoices() {
  const { rows, error } = useList<PortalInvoice>(api.invoices);

  // The archived PDF, or a 404 in a new tab. The portal cannot render one — that would
  // mean reaching into Billing. Opened as a navigation so the session cookie goes with it.
  const download = (invoice: PortalInvoice) => openFile(`/invoices/${invoice.id}/pdf`);

  return (
    <Page title="Facturen" lead="Wat er openstaat en wat voldaan is, met de pdf erbij.">
      <Listing rows={rows} error={error} empty="Er zijn nog geen facturen.">
        {(invoices) => (
          <Card>
            <table>
            <thead>
              <tr>
                <th>Nummer</th>
                <th>Datum</th>
                <th className="num">Bedrag</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="nowrap">{i.number}</td>
                  <td className="nowrap">
                    {date(i.issue_date)}
                    {/* The due date under the issue date rather than beside it: nobody
                        scans a column of due dates, they check one invoice's. */}
                    <span className="meta">vervalt {date(i.due_on)}</span>
                  </td>
                  <td className="num">{euros(i.total_cents, i.currency)}</td>
                  <td>
                    {i.status === 'paid' ? (
                      <span className="tag">Voldaan</span>
                    ) : i.overdue ? (
                      <span className="tag overdue">Vervallen</span>
                    ) : (
                      <span className="tag">Openstaand</span>
                    )}
                  </td>
                  <td className="num">
                    <button className="link" onClick={() => download(i)}>
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </Card>
        )}
      </Listing>
    </Page>
  );
}
