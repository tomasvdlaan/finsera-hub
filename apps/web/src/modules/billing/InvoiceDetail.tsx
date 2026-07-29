import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useToast } from '../../shell/ui/Toast.js';
import { getUser } from '../../lib/auth.js';
import { Timeline } from '../../shell/Timeline.js';
import type { Client } from '../crm/types.js';
import { LineEditor } from './LineEditor.js';
import { VAT_LABELS, money, type InvoiceDetail as Detail } from './types.js';

export function InvoiceDetail() {
  const { confirm } = useDialog();
  const toast = useToast();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<Detail | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const inv = await api.get<Detail>(`/billing/invoices/${id}`);
      setInvoice(inv);
      setClient(await api.get<Client>(`/crm/clients/${inv.clientId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const issue = () =>
    act(async () => {
      // The one irreversible click in the platform — name the consequence before doing it.
      const go = await confirm({
        title: 'Issue this invoice?',
        body: 'It is allocated its legal number and becomes immutable. After this, a correction is a credit note.',
        confirmLabel: 'Issue invoice',
      });
      if (!go) return;
      await api.post(`/billing/invoices/${id}/issue`, {});
      toast.ok('Invoice issued');
    });

  const download = async (kind: 'pdf' | 'ubl') => {
    const user = await getUser();
    const res = await fetch(`/api/billing/invoices/${id}/${kind}`, {
      headers: user?.access_token ? { Authorization: `Bearer ${user.access_token}` } : {},
    });
    if (!res.ok) {
      setError(`${res.status} ${res.statusText}`);
      return;
    }
    const blob = await res.blob();
    const name =
      res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? `invoice.${kind}`;
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
    URL.revokeObjectURL(href);
  };

  if (!invoice) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const isDraft = invoice.status === 'draft';
  const title =
    invoice.number ?? (invoice.kind === 'credit_note' ? 'Draft credit note' : 'Draft invoice');

  return (
    <>
      <p>
        <Link to="/billing">← Invoices</Link>
        {client && (
          <>
            {' · '}
            <Link to={`/crm/clients/${client.id}`}>{client.name}</Link>
          </>
        )}
      </p>
      <h1>{title}</h1>

      <div className="row">
        <span className="badge">{invoice.status}</span>
        {invoice.overdue && <span className="badge priority-urgent">overdue</span>}
        <span className="badge">{VAT_LABELS[invoice.vatTreatment]}</span>
        {invoice.creditsInvoiceId && (
          <Link to={`/billing/invoices/${invoice.creditsInvoiceId}`}>credits an invoice</Link>
        )}
      </div>

      <div className="row">
        {isDraft && (
          <>
            <button onClick={() => void issue()} disabled={busy}>
              Issue invoice
            </button>
            <button
              className="link-button destructive"
              onClick={() =>
                void act(async () => {
                  const go = await confirm({
                    title: 'Void this draft?',
                    body: 'The draft and its lines are discarded, and the hours on it become billable again.',
                    confirmLabel: 'Void draft',
                    destructive: true,
                  });
                  if (!go) return;
                  await api.del(`/billing/invoices/${id}`);
                  toast.ok('Draft voided — its hours are billable again');
                  navigate('/billing');
                })
              }
            >
              void draft
            </button>
          </>
        )}
        {invoice.status === 'issued' && (
          <>
            <button onClick={() => void act(() => api.post(`/billing/invoices/${id}/mark-paid`, {}))} disabled={busy}>
              Mark paid
            </button>
            <button
              className="link-button"
              onClick={() =>
                void act(async () => {
                  const credit = await api.post<{ id: string }>(
                    `/billing/invoices/${id}/credit-note`,
                    {},
                  );
                  navigate(`/billing/invoices/${credit.id}`);
                })
              }
            >
              create credit note
            </button>
          </>
        )}
        <button className="link-button" onClick={() => void download('pdf')}>
          {isDraft ? 'preview PDF (concept)' : 'download PDF'}
        </button>
        {!isDraft && (
          <button className="link-button" onClick={() => void download('ubl')}>
            download UBL
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>Lines</h2>
        {isDraft ? (
          <LineEditor invoice={invoice} onSaved={() => void load()} />
        ) : (
        <div className="grid-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Description</th>
                <th>Hours</th>
                <th>Rate</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id}>
                  <td style={{ textAlign: 'left' }}>{line.description}</td>
                  <td>{line.quantity}</td>
                  <td>{money(line.unitPriceCents)}</td>
                  <td>{money(line.amountCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3} style={{ textAlign: 'right' }}>
                  Subtotal
                </th>
                <td className="total">{money(invoice.subtotalCents)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3} style={{ textAlign: 'right' }}>
                  {invoice.vatTreatment === 'domestic_21' ? 'BTW 21%' : 'BTW 0%'}
                </th>
                <td className="total">{money(invoice.vatCents)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3} style={{ textAlign: 'right' }}>
                  Total
                </th>
                <td className="total">{money(invoice.totalCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        )}
        {invoice.vatLegend && <p className="muted">{invoice.vatLegend}</p>}
        {invoice.status === 'issued' && (
          <p className="muted">
            Issued {invoice.issueDate} · due {invoice.dueOn}. This invoice is immutable —
            corrections require a credit note.
          </p>
        )}
      </section>

      <section>
        <h2>Timeline</h2>
        <Timeline entityId={id} />
      </section>
    </>
  );
}
