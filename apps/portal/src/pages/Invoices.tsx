import { useState } from 'react';
import { api, openFile, type PortalInvoice } from '../lib/api.js';
import { Listing, date, euros, useList } from './shared.js';

export function Invoices() {
  const { rows, error } = useList<PortalInvoice>(api.invoices);
  const [failed, setFailed] = useState<string>();

  const download = (invoice: PortalInvoice) => {
    setFailed(undefined);
    // The archived PDF, or nothing. The portal cannot render one — that would mean
    // reaching into Billing — so a missing archive surfaces here rather than silently.
    openFile(`/invoices/${invoice.id}/pdf`, `${invoice.number}.pdf`).catch((err: Error) =>
      setFailed(`Factuur ${invoice.number}: ${err.message}`),
    );
  };

  return (
    <Listing rows={rows} error={error} empty="Er zijn nog geen facturen.">
      {(invoices) => (
        <>
          {failed && <p className="error">{failed}</p>}
          <table>
            <thead>
              <tr>
                <th>Nummer</th>
                <th>Datum</th>
                <th>Vervaldatum</th>
                <th className="num">Bedrag</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td>{i.number}</td>
                  <td>{date(i.issue_date)}</td>
                  <td>{date(i.due_on)}</td>
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
        </>
      )}
    </Listing>
  );
}
