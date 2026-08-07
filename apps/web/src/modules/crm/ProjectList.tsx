import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { PageHeader, SubNav } from '../../shell/ui/layout.js';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  BILLING_MODELS,
  PROJECT_STATUSES,
  RETAINER_PERIODS,
  formatMoney,
  humanise,
  type BillingModel,
  type Client,
  type Project,
} from './types.js';
import { Empty } from '../../shell/ui/primitives.js';

/** Euro input → integer cents. Money never becomes a float on the way to the API. */
const toCents = (euros: string): number | null => {
  const trimmed = euros.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
};

/**
 * Who the work is for, at two grains.
 *
 * A client and a project are the same subject seen at different resolutions — you arrive
 * wanting one and find you wanted the other about as often as not — so they are two modes of
 * one place rather than two destinations. This is also what buys back the ninth pill anchor.
 */
const WHO = [
  { label: 'Clients', to: '/clients' },
  { label: 'Projects', to: '/projects' },
];

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [billingModel, setBillingModel] = useState<BillingModel>('time_and_materials');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('');
  const [hours, setHours] = useState('');
  const [period, setPeriod] = useState<string>('monthly');
  const [busy, setBusy] = useState(false);

  const clientName = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  const load = () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    return api
      .get<Project[]>(`/crm/projects?${params}`)
      .then(setProjects)
      .catch((e: Error) => setError(e.message));
  };

  useEffect(() => {
    void load();
  }, [statusFilter]);

  useEffect(() => {
    api
      .get<Client[]>('/crm/clients')
      .then((cs) => {
        setClients(cs);
        setClientId((current) => current || (cs[0]?.id ?? ''));
      })
      .catch(() => setClients([]));
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !clientId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/crm/projects', {
        clientId,
        name: name.trim(),
        billingModel,
        defaultRateCents: billingModel !== 'fixed_fee' ? toCents(rate) : null,
        budgetAmountCents: billingModel !== 'retainer' ? toCents(amount) : null,
        budgetHours: billingModel === 'time_and_materials' && hours ? Number(hours) : null,
        retainerAmountCents: billingModel === 'retainer' ? toCents(amount) : null,
        retainerPeriod: billingModel === 'retainer' ? period : null,
      });
      setName('');
      setRate('');
      setAmount('');
      setHours('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Billing model is per project — time &amp; materials, fixed fee, or retainer."
        tabs={<SubNav items={WHO} />}
      />

      <form onSubmit={(e) => void create(e)}>
        <div className="row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            aria-label="Project name"
          />
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            aria-label="Client"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={billingModel}
            onChange={(e) => setBillingModel(e.target.value as BillingModel)}
            aria-label="Billing model"
          >
            {BILLING_MODELS.map((m) => (
              <option key={m} value={m}>
                {humanise(m)}
              </option>
            ))}
          </select>
        </div>

        {/* Only the fields this billing model actually needs. */}
        <div className="row">
          {billingModel === 'time_and_materials' && (
            <>
              <input
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="Rate €/hr"
                aria-label="Hourly rate in euro"
              />
              <input
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="Budget hours"
                aria-label="Budget hours"
              />
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Budget cap € (optional)"
                aria-label="Budget cap in euro"
              />
            </>
          )}
          {billingModel === 'fixed_fee' && (
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Agreed price € (required)"
              aria-label="Agreed price in euro"
            />
          )}
          {billingModel === 'retainer' && (
            <>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount € (required)"
                aria-label="Retainer amount in euro"
              />
              <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
                {RETAINER_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </>
          )}
          <button type="submit" disabled={busy || !name.trim() || !clientId}>
            {busy ? 'Adding…' : 'Add project'}
          </button>
        </div>
      </form>

      <div className="row">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="error">{error}</p>}

      {projects.length === 0 ? (
        <Empty>No projects yet.</Empty>
      ) : (
        <ul className="cards">
          {projects.map((p) => (
            <li key={p.id}>
              <Link to={`/projects/${p.id}`}>{p.name}</Link>{' '}
              <span className="badge">{humanise(p.billingModel)}</span>{' '}
              <span className="muted">
                {clientName[p.clientId] ?? '—'} · {humanise(p.status)}
                {p.billingModel === 'retainer'
                  ? ` · ${formatMoney(p.retainerAmountCents, p.currency)}/${p.retainerPeriod}`
                  : p.budgetAmountCents != null
                    ? ` · ${formatMoney(p.budgetAmountCents, p.currency)}`
                    : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
