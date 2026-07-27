import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { ChatWidgetProps } from '../types.js';
import { money, type Invoice } from './types.js';

/** An invoice, as the assistant shows it. Read-only: money documents get no chat actions. */
export function InvoiceChatCard({ id, displayName, urlPath }: ChatWidgetProps) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    api
      .get<Invoice>(`/billing/invoices/${id}`)
      .then(setInvoice)
      .catch(() => setInvoice(null));
  }, [id]);

  return (
    <div className="chat-card">
      <div className="chat-card-head">
        <span className="badge">{invoice?.kind === 'credit_note' ? 'credit note' : 'invoice'}</span>
        <Link to={urlPath}>{invoice?.number ?? displayName}</Link>
        {invoice?.overdue && <span className="badge priority-urgent">overdue</span>}
      </div>
      {invoice && (
        <div className="muted">
          {invoice.status} · {money(invoice.totalCents)}
          {invoice.dueOn && invoice.status === 'issued' && ` · due ${invoice.dueOn}`}
        </div>
      )}
      <div className="chat-card-actions">
        <Link to={urlPath}>open</Link>
      </div>
    </div>
  );
}
