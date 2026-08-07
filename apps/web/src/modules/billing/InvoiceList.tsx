import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { Client, Project } from '../crm/types.js';
import { VAT_LABELS, money, type Invoice } from './types.js';
import { Empty, Status } from '../../shell/ui/primitives.js';

export function InvoiceList() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState('');
  const [draftProject, setDraftProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = status ? `?status=${status}` : '';
    return api
      .get<Invoice[]>(`/billing/invoices${q}`)
      .then(setInvoices)
      .catch((e: Error) => setError(e.message));
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.get<Client[]>('/crm/clients').then(setClients).catch(() => setClients([]));
    api.get<Project[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
  }, []);

  const clientName = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  const draftFromHours = async () => {
    if (!draftProject) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/billing/invoices/draft-from-hours', { projectId: draftProject });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const open = invoices.filter((i) => i.status === 'issued');
  const outstanding = open.reduce((sum, i) => sum + i.totalCents, 0);

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Drafts are free to edit and void. Issuing allocates the legal number and freezes the invoice — corrections after that are credit notes."
      />

      {open.length > 0 && (
        <p>
          <strong>{money(outstanding)}</strong>{' '}
          <span className="muted">
            outstanding across {open.length} invoice{open.length === 1 ? '' : 's'}
            {open.some((i) => i.overdue) && ' — some overdue'}
          </span>
        </p>
      )}

      <div className="row">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="draft">draft</option>
          <option value="issued">issued</option>
          <option value="paid">paid</option>
        </select>

        <span className="muted">·</span>

        <select
          value={draftProject}
          onChange={(e) => setDraftProject(e.target.value)}
          aria-label="Project to invoice"
        >
          <option value="">Draft from hours…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button onClick={() => void draftFromHours()} disabled={busy || !draftProject}>
          {busy ? 'Drafting…' : 'Create draft'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {invoices.length === 0 ? (
        <Empty>No invoices yet.</Empty>
      ) : (
        <ul className="cards">
          {invoices.map((invoice) => (
            <li key={invoice.id}>
              <Link to={`/money/invoices/${invoice.id}`}>
                {invoice.number ??
                  (invoice.kind === 'credit_note' ? 'Draft credit note' : 'Draft invoice')}
              </Link>{' '}
              <Status value={invoice.status} />
              {invoice.overdue && <span className="badge priority-urgent">overdue</span>}{' '}
              <span className="muted">
                {clientName[invoice.clientId] ?? '—'} · {money(invoice.totalCents)} ·{' '}
                {VAT_LABELS[invoice.vatTreatment]}
                {invoice.dueOn && invoice.status === 'issued' && ` · due ${invoice.dueOn}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
