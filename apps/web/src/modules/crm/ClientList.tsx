import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { CLIENT_STATUSES, humanise, type Client, type ClientStatus } from './types.js';

/**
 * Client list — and, grouped by status, the pipeline view. A prospect and a customer are
 * the same record at different stages, so one screen serves both.
 */
export function ClientList() {
  const [clients, setClients] = useState<Client[]>([]);
  const [filter, setFilter] = useState<ClientStatus | ''>('');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    const params = new URLSearchParams();
    if (filter) params.set('status', filter);
    if (query) params.set('query', query);
    return api
      .get<Client[]>(`/crm/clients?${params}`)
      .then(setClients)
      .catch((e: Error) => setError(e.message));
  };

  useEffect(() => {
    void load();
  }, [filter, query]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/crm/clients', { name: name.trim() });
      setName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const byStatus = CLIENT_STATUSES.map((s) => ({
    status: s,
    items: clients.filter((c) => c.status === s),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <h1>Clients</h1>
      <p className="muted">
        Prospects and customers are the same record at different stages — the pipeline is this
        list, grouped by status.
      </p>

      <form onSubmit={(e) => void create(e)} className="row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New client name"
          aria-label="New client name"
        />
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add client'}
        </button>
      </form>

      <div className="row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          aria-label="Search clients"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ClientStatus | '')}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {CLIENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="error">{error}</p>}

      {clients.length === 0 ? (
        <p className="muted">No clients yet.</p>
      ) : (
        byStatus.map((group) => (
          <section key={group.status} style={{ marginTop: '1.25rem' }}>
            <h2>
              {humanise(group.status)} <span className="muted">({group.items.length})</span>
            </h2>
            <ul className="cards">
              {group.items.map((c) => (
                <li key={c.id}>
                  <Link to={`/crm/clients/${c.id}`}>{c.name}</Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
