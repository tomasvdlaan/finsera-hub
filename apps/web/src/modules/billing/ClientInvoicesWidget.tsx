import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { money, type Invoice } from './types.js';
import { Status } from '../../shell/ui/primitives.js';

/** Invoices for one client — contributed to CRM's client page through the manifest. */
export function ClientInvoicesWidget({ clientId }: { clientId: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    api
      .get<Invoice[]>(`/billing/invoices?clientId=${clientId}`)
      .then(setInvoices)
      .catch(() => setInvoices([]));
  }, [clientId]);

  if (invoices.length === 0) {
    return (
      <p className="muted">
        No invoices yet — <Link to="/money/invoices">open invoices</Link>.
      </p>
    );
  }

  const outstanding = invoices
    .filter((i) => i.status === 'issued')
    .reduce((sum, i) => sum + i.totalCents, 0);

  return (
    <div>
      {outstanding > 0 && (
        <p className="muted">
          <strong>{money(outstanding)}</strong> outstanding
        </p>
      )}
      <ul className="cards">
        {invoices.slice(0, 6).map((invoice) => (
          <li key={invoice.id}>
            <Link to={`/money/invoices/${invoice.id}`}>
              {invoice.number ?? 'Draft'}
            </Link>{' '}
            <Status value={invoice.status} />
            {invoice.overdue && <span className="badge priority-urgent">overdue</span>}{' '}
            <span className="muted">{money(invoice.totalCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
