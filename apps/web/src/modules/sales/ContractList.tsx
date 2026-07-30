import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { Client } from '../crm/types.js';
import { CONTRACT_TYPES, TYPE_LABELS, type Contract, type ContractType } from './contractTypes.js';
import { Empty, Status } from '../../shell/ui/primitives.js';

/** The one line worth reading per contract: when does this need attention? */
export function contractUrgency(c: Contract): { label: string; urgent: boolean } | null {
  if (c.status !== 'signed') return null;
  if (c.expired) return { label: 'expired', urgent: true };
  if (c.noticeClosingSoon && c.noticeDeadline) {
    return { label: `notice by ${c.noticeDeadline}`, urgent: true };
  }
  if (c.expiringSoon && c.daysUntilEnd != null) {
    return { label: `ends in ${c.daysUntilEnd} days`, urgent: false };
  }
  return null;
}

export function ContractList() {
  const navigate = useNavigate();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [type, setType] = useState('');
  const [newClient, setNewClient] = useState('');
  const [newType, setNewType] = useState<ContractType>('framework');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = type ? `?type=${type}` : '';
    return api
      .get<Contract[]>(`/sales/contracts${q}`)
      .then(setContracts)
      .catch((e: Error) => setError(e.message));
  }, [type]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<Client[]>('/crm/clients')
      .then((rows) => {
        setClients(rows);
        setNewClient((c) => c || (rows[0]?.id ?? ''));
      })
      .catch(() => setClients([]));
  }, []);

  const clientName = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!newClient || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const contract = await api.post<Contract>('/sales/contracts', {
        clientId: newClient,
        type: newType,
        title: title.trim(),
      });
      navigate(`/sales/contracts/${contract.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const needsAttention = contracts.filter((c) => contractUrgency(c)?.urgent);

  return (
    <>
      <h1>Contracts</h1>
      <p className="muted">
        What has been agreed, and when it lapses. Notice deadlines are worked out from
        today — nothing changes state on its own, so a date passing is shown, not acted on.
      </p>

      {needsAttention.length > 0 && (
        <p className="error">
          {needsAttention.length} contract{needsAttention.length === 1 ? '' : 's'} need
          {needsAttention.length === 1 ? 's' : ''} attention — see the badges below.
        </p>
      )}

      <form onSubmit={(e) => void create(e)}>
        <div className="row">
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter type">
            <option value="">All types</option>
            {CONTRACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>

          <span className="muted">·</span>

          <select
            value={newClient}
            onChange={(e) => setNewClient(e.target.value)}
            aria-label="Client"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as ContractType)}
            aria-label="New contract type"
          >
            {CONTRACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Contract title"
            aria-label="Contract title"
            style={{ flex: 1, minWidth: 200 }}
          />
          <button type="submit" disabled={busy || !title.trim() || !newClient}>
            {busy ? 'Adding…' : 'Add contract'}
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      {contracts.length === 0 ? (
        <Empty>No contracts recorded yet.</Empty>
      ) : (
        <ul className="cards">
          {contracts.map((contract) => {
            const urgency = contractUrgency(contract);
            return (
              <li key={contract.id}>
                <Link to={`/sales/contracts/${contract.id}`}>{contract.title}</Link>{' '}
                <span className="badge">{TYPE_LABELS[contract.type]}</span>
                <Status value={contract.status} />
                {urgency && (
                  <span className={`badge${urgency.urgent ? ' priority-urgent' : ''}`}>
                    {urgency.label}
                  </span>
                )}{' '}
                <span className="muted">
                  {clientName[contract.clientId] ?? '—'}
                  {contract.endsOn && ` · ends ${contract.endsOn}`}
                  {contract.autoRenews === 'yes' && ' · auto-renews'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
