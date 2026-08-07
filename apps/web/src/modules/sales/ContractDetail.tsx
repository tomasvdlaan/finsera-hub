import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useToast } from '../../shell/ui/Toast.js';
import { Timeline } from '../../shell/Timeline.js';
import { EditableField } from '../crm/EditableField.js';
import type { Client } from '../crm/types.js';
import { contractUrgency } from './ContractList.js';
import { TYPE_LABELS, type Contract } from './contractTypes.js';
import { Status } from '../../shell/ui/primitives.js';

export function ContractDetail() {
  const { confirm, ask } = useDialog();
  const toast = useToast();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [contract, setContract] = useState<Contract | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await api.get<Contract>(`/sales/contracts/${id}`);
      setContract(c);
      setClient(await api.get<Client>(`/crm/clients/${c.clientId}`));
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
    act(() => api.patch(`/sales/contracts/${id}`, body));

  if (!contract) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const isDraft = contract.status === 'draft';
  const urgency = contractUrgency(contract);

  return (
    <>
      <PageHeader
        title={contract.title}
        back={{ to: "/sales/contracts", label: 'Contracts' }}
        meta={
          <>
          {client && (
            <Link to={`/clients/${client.id}`}>{client.name}</Link>
          )}
          </>
        }
      />

      <div className="row">
        <span className="badge">{TYPE_LABELS[contract.type]}</span>
        <Status value={contract.status} />
        {urgency && (
          <span className={`badge${urgency.urgent ? ' priority-urgent' : ''}`}>
            {urgency.label}
          </span>
        )}
        {contract.documentId && (
          <Link to={`/docs/${contract.documentId}`}>view the signed document</Link>
        )}
      </div>

      <div className="row">
        {isDraft && (
          <>
            <button
              onClick={() =>
                void act(async () => {
                  const go = await confirm({
                    title: 'Mark this contract signed?',
                    body: 'Its terms freeze. An amendment after this becomes a new contract.',
                    confirmLabel: 'Mark signed',
                  });
                  if (!go) return;
                  await api.post(`/sales/contracts/${id}/sign`, {});
                  toast.ok('Contract marked signed');
                })
              }
              disabled={busy}
            >
              Mark signed
            </button>
            <button
              className="link-button destructive"
              onClick={() =>
                void act(async () => {
                  await api.del(`/sales/contracts/${id}`);
                  navigate('/money/contracts');
                })
              }
            >
              delete draft
            </button>
          </>
        )}
        {contract.status === 'signed' && (
          <button
            className="link-button destructive"
            onClick={() =>
              void act(async () => {
                const values = await ask({
                  title: 'Terminate this contract',
                  body: 'Recorded against the contract; the notice period still applies.',
                  confirmLabel: 'Terminate',
                  destructive: true,
                  fields: [{ name: 'reason', label: 'Reason (optional)' }],
                });
                // Cancel means cancel. Written as `reason: (await ask())?.reason` this
                // still posted the termination with no reason when you backed out.
                if (!values) return;
                await api.post(`/sales/contracts/${id}/terminate`, {
                  reason: values.reason || undefined,
                });
                toast.ok('Contract terminated');
              })
            }
          >
            terminate
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>Terms</h2>
        {isDraft ? (
          <>
            <EditableField label="Title" value={contract.title} onSave={(v) => patch({ title: v })} />
            <EditableField
              label="Client reference"
              value={contract.reference}
              placeholder="Their contract number, if they use one"
              onSave={(v) => patch({ reference: v })}
            />
            <EditableField
              label="Starts on"
              value={contract.startsOn}
              placeholder="YYYY-MM-DD"
              onSave={(v) => patch({ startsOn: v })}
            />
            <EditableField
              label="Ends on"
              value={contract.endsOn}
              placeholder="YYYY-MM-DD, or blank for open-ended"
              onSave={(v) => patch({ endsOn: v })}
            />
            <EditableField
              label="Notice period (days)"
              value={contract.noticeDays == null ? null : String(contract.noticeDays)}
              onSave={(v) => patch({ noticeDays: v ? Number(v) : null })}
            />
            <div className="row">
              <span className="muted">Auto-renews:</span>
              <select
                value={contract.autoRenews}
                onChange={(e) =>
                  void patch({
                    autoRenews: e.target.value,
                    renewalMonths: e.target.value === 'yes' ? (contract.renewalMonths ?? 12) : null,
                  })
                }
                aria-label="Auto renews"
              >
                <option value="no">no</option>
                <option value="yes">yes</option>
              </select>
              {contract.autoRenews === 'yes' && (
                <EditableField
                  label="every (months)"
                  value={contract.renewalMonths == null ? null : String(contract.renewalMonths)}
                  onSave={(v) => patch({ renewalMonths: v ? Number(v) : 12 })}
                />
              )}
            </div>
            {contract.type === 'dpa' && (
              <div className="row">
                <span className="muted">Permits sub-processors:</span>
                <select
                  value={contract.allowsSubProcessors ?? ''}
                  onChange={(e) => void patch({ allowsSubProcessors: e.target.value || null })}
                  aria-label="Permits sub-processors"
                >
                  <option value="">not recorded</option>
                  <option value="yes">yes</option>
                  <option value="no">no</option>
                  <option value="unclear">unclear</option>
                </select>
              </div>
            )}
            <EditableField
              label="Document ID"
              value={contract.documentId}
              placeholder="Paste the id of the signed PDF in Documents"
              onSave={(v) => patch({ documentId: v })}
            />
            <EditableField
              label="Notes"
              value={contract.notes}
              multiline
              onSave={(v) => patch({ notes: v })}
            />
          </>
        ) : (
          <dl className="terms">
            <dt>Runs</dt>
            <dd>
              {contract.startsOn ?? '—'} → {contract.endsOn ?? 'open-ended'}
              {contract.daysUntilEnd != null && (
                <span className="muted">
                  {' '}
                  ({contract.daysUntilEnd >= 0
                    ? `${contract.daysUntilEnd} days left`
                    : `ended ${-contract.daysUntilEnd} days ago`})
                </span>
              )}
            </dd>
            <dt>Notice</dt>
            <dd>
              {contract.noticeDays != null ? `${contract.noticeDays} days` : '—'}
              {contract.noticeDeadline && (
                <span className="muted"> · give notice by {contract.noticeDeadline}</span>
              )}
            </dd>
            <dt>Renewal</dt>
            <dd>
              {contract.autoRenews === 'yes'
                ? `Rolls over every ${contract.renewalMonths} months unless notice is given`
                : 'Does not auto-renew'}
            </dd>
            {contract.type === 'dpa' && (
              <>
                <dt>Sub-processors</dt>
                <dd>
                  {contract.allowsSubProcessors ?? 'not recorded'}
                  <span className="muted">
                    {' '}
                    — determines whether AI providers may process this client&rsquo;s data
                  </span>
                </dd>
              </>
            )}
            {contract.reference && (
              <>
                <dt>Their reference</dt>
                <dd>{contract.reference}</dd>
              </>
            )}
            {contract.notes && (
              <>
                <dt>Notes</dt>
                <dd>{contract.notes}</dd>
              </>
            )}
          </dl>
        )}
        {!isDraft && (
          <p className="muted">
            Signed {contract.signedAt?.slice(0, 10)}. The terms are immutable — an amendment is
            recorded as a new contract, so what was agreed stays exactly as it was agreed.
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
