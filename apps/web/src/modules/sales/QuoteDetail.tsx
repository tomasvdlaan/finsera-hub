import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useToast } from '../../shell/ui/Toast.js';
import { getUser } from '../../lib/auth.js';
import { Timeline } from '../../shell/Timeline.js';
import { EditableField } from '../crm/EditableField.js';
import type { Client, Project } from '../crm/types.js';
import { QuoteLineEditor } from './QuoteLineEditor.js';
import { UNIT_LABELS, money, type QuoteDetail as Detail } from './types.js';

export function QuoteDetail() {
  const { confirm, ask } = useDialog();
  const toast = useToast();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [quote, setQuote] = useState<Detail | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = await api.get<Detail>(`/sales/quotes/${id}`);
      setQuote(q);
      setClient(await api.get<Client>(`/crm/clients/${q.clientId}`));
      setProjects(await api.get<Project[]>(`/crm/projects?clientId=${q.clientId}`));
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

  const patch = (body: Record<string, unknown>) =>
    act(() => api.patch(`/sales/quotes/${id}`, body));

  const send = () =>
    act(async () => {
      const go = await confirm({
        title: 'Send this quote?',
        body: 'It is allocated its number and freezes, so the version the client reads stays exactly as they read it. Changes after this are a revision.',
        confirmLabel: 'Send quote',
      });
      if (!go) return;
      await api.post(`/sales/quotes/${id}/send`, {});
      toast.ok('Quote sent');
    });

  const accept = () =>
    act(async () => {
      const existing = projects.filter((p) => p.id !== quote?.projectCreatedId);

      /*
       * One question with one answer, replacing a confirm whose Cancel meant "no, do the
       * other thing" — the most confusing shape a dialog can take, because Cancel
       * everywhere else means "do nothing" and here it committed you to a second prompt.
       */
      if (existing.length === 0) {
        const go = await confirm({
          title: 'Accept this quote?',
          body: `A new project "${quote?.title}" is created, carrying the quote's rate and budget.`,
          confirmLabel: 'Accept and create project',
        });
        if (!go) return;
        await api.post(`/sales/quotes/${id}/accept`, { createProject: true });
        toast.ok('Quote accepted');
        return;
      }

      const values = await ask({
        title: 'Accept this quote',
        body: 'Accepting records the client’s agreement. The work needs a project to hang off.',
        confirmLabel: 'Accept quote',
        fields: [
          {
            name: 'projectId',
            label: 'Attach the work to',
            type: 'select',
            defaultValue: 'new',
            options: [
              { value: 'new', label: `New project — ${quote?.title ?? 'this quote'}` },
              ...existing.map((p) => ({ value: p.id, label: p.name })),
            ],
          },
        ],
      });
      if (!values) return;
      await api.post(
        `/sales/quotes/${id}/accept`,
        values.projectId === 'new'
          ? { createProject: true }
          : { attachToProjectId: values.projectId },
      );
      toast.ok('Quote accepted');
    });

  const downloadPdf = async () => {
    const user = await getUser();
    const res = await fetch(`/api/sales/quotes/${id}/pdf`, {
      headers: user?.access_token ? { Authorization: `Bearer ${user.access_token}` } : {},
    });
    if (!res.ok) {
      setError(`${res.status} ${res.statusText}`);
      return;
    }
    const blob = await res.blob();
    const name =
      res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'offerte.pdf';
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
    URL.revokeObjectURL(href);
  };

  if (!quote) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const isDraft = quote.status === 'draft';

  return (
    <>
      <p>
        <Link to="/sales">← Quotes</Link>
        {client && (
          <>
            {' · '}
            <Link to={`/crm/clients/${client.id}`}>{client.name}</Link>
          </>
        )}
        {quote.supersedesQuoteId && (
          <>
            {' · '}
            <Link to={`/sales/quotes/${quote.supersedesQuoteId}`}>supersedes v{quote.version - 1}</Link>
          </>
        )}
      </p>
      <h1>{quote.number ?? 'Draft quote'}</h1>

      <div className="row">
        <span className="badge">{quote.status}</span>
        {quote.expired && <span className="badge priority-urgent">past its validity date</span>}
        {quote.version > 1 && <span className="badge">version {quote.version}</span>}
        {quote.projectCreatedId && (
          <Link to={`/crm/projects/${quote.projectCreatedId}`}>view the project</Link>
        )}
      </div>

      <div className="row">
        {isDraft && (
          <>
            <button onClick={() => void send()} disabled={busy}>
              Send quote
            </button>
            <button
              className="link-button destructive"
              onClick={() =>
                void act(async () => {
                  await api.del(`/sales/quotes/${id}`);
                  navigate('/sales');
                })
              }
            >
              delete draft
            </button>
          </>
        )}
        {quote.status === 'sent' && (
          <>
            <button onClick={() => void accept()} disabled={busy}>
              Mark accepted
            </button>
            <button
              className="link-button"
              onClick={() =>
                void act(async () => {
                  const values = await ask({
                    title: 'Mark this quote rejected',
                    body: 'The reason is kept with the quote, so next year’s pricing has the context.',
                    confirmLabel: 'Mark rejected',
                    fields: [{ name: 'reason', label: 'Why was it rejected? (optional)' }],
                  });
                  if (!values) return;
                  await api.post(`/sales/quotes/${id}/reject`, {
                    reason: values.reason || undefined,
                  });
                  toast.ok('Quote marked rejected');
                })
              }
            >
              mark rejected
            </button>
            <button
              className="link-button"
              onClick={() =>
                void act(async () => {
                  const revision = await api.post<{ id: string }>(
                    `/sales/quotes/${id}/revise`,
                    {},
                  );
                  navigate(`/sales/quotes/${revision.id}`);
                })
              }
            >
              create revision
            </button>
          </>
        )}
        <button className="link-button" onClick={() => void downloadPdf()}>
          {isDraft ? 'preview PDF (concept)' : 'download PDF'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>The offer</h2>
        {isDraft ? (
          <>
            <EditableField label="Title" value={quote.title} onSave={(v) => patch({ title: v })} />
            <EditableField
              label="Introduction"
              value={quote.introduction}
              multiline
              placeholder="The scope, in words the client will read before any numbers"
              onSave={(v) => patch({ introduction: v })}
            />
            <EditableField
              label="Valid until"
              value={quote.validUntil}
              onSave={(v) => patch({ validUntil: v })}
            />
            <EditableField
              label="Hourly rate (cents)"
              value={quote.hourlyRateCents == null ? null : String(quote.hourlyRateCents)}
              placeholder="Becomes the project rate when accepted"
              onSave={(v) => patch({ hourlyRateCents: v ? Number(v) : null })}
            />
            <EditableField
              label="Notes"
              value={quote.notes}
              multiline
              onSave={(v) => patch({ notes: v })}
            />
          </>
        ) : (
          <>
            <p>
              <strong>{quote.title}</strong>
            </p>
            {quote.introduction && <p>{quote.introduction}</p>}
            <p className="muted">
              Sent {quote.issueDate} · valid to {quote.validUntil}
              {quote.hourlyRateCents != null && ` · ${money(quote.hourlyRateCents)}/hr`}
            </p>
          </>
        )}
      </section>

      <section>
        <h2>Lines</h2>
        {isDraft ? (
          <QuoteLineEditor quote={quote} onSaved={() => void load()} />
        ) : (
          <div className="grid-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Description</th>
                  <th>Quantity</th>
                  <th>Price</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {quote.lines.map((line) => (
                  <tr key={line.id}>
                    <td style={{ textAlign: 'left' }}>{line.description}</td>
                    <td>
                      {line.unit === 'fixed'
                        ? '—'
                        : `${line.quantity} ${UNIT_LABELS[line.unit]}`}
                    </td>
                    <td>{line.unit === 'fixed' ? '—' : money(line.unitPriceCents)}</td>
                    <td>{money(line.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3} style={{ textAlign: 'right' }}>
                    Subtotal
                  </th>
                  <td className="total">{money(quote.subtotalCents)}</td>
                </tr>
                <tr>
                  <th scope="row" colSpan={3} style={{ textAlign: 'right' }}>
                    {quote.vatTreatment === 'domestic_21' ? 'BTW 21%' : 'BTW 0%'}
                  </th>
                  <td className="total">{money(quote.vatCents)}</td>
                </tr>
                <tr>
                  <th scope="row" colSpan={3} style={{ textAlign: 'right' }}>
                    Total
                  </th>
                  <td className="total">{money(quote.totalCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {quote.vatLegend && <p className="muted">{quote.vatLegend}</p>}
        {quote.status !== 'draft' && (
          <p className="muted">
            This quote has been sent and is immutable — a change is a new revision, so the
            version the client read stays exactly as they read it.
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
