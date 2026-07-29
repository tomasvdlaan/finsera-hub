import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api.js';
import type { Client, Project } from '../crm/types.js';
import { money } from './types.js';
import type { RateCard } from './contractTypes.js';

/**
 * Rate cards.
 *
 * A card records what an hour costs and since when. It does not change what an invoice
 * bills on its own — applying a rate to a project is an explicit act, so an edit here can
 * never quietly alter a draft invoice.
 */
export function RateCards() {
  const [cards, setCards] = useState<RateCard[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [cardClient, setCardClient] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api
        .get<RateCard[]>('/sales/rate-cards')
        .then(setCards)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    void load();
    api.get<Client[]>('/crm/clients').then(setClients).catch(() => setClients([]));
    api.get<Project[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
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

  const createCard = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    return act(async () => {
      await api.post('/sales/rate-cards', {
        name: name.trim(),
        clientId: cardClient || null,
      });
      setName('');
    });
  };

  const addRate = (card: RateCard) =>
    act(async () => {
      const role = window.prompt('Role?', 'Consultant');
      if (!role) return;
      const euros = window.prompt(`Rate for ${role} in euros per hour?`, '35.00');
      if (!euros) return;
      const from = window.prompt('In force from? (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
      if (!from) return;
      await api.post(`/sales/rate-cards/${card.id}/rates`, {
        role: role.trim(),
        rateCents: Math.round(Number(euros.replace(',', '.')) * 100),
        effectiveFrom: from,
      });
    });

  const applyToProject = (card: RateCard, role: string) =>
    act(async () => {
      const options = projects.filter((p) => !card.clientId || p.clientId === card.clientId);
      if (options.length === 0) throw new Error('No projects for this client');
      const chosen = window.prompt(
        `Apply the ${role} rate to which project?\n\n${options.map((p) => p.name).join('\n')}`,
        options[0]?.name ?? '',
      );
      const project = options.find((p) => p.name === chosen?.trim());
      if (!project) throw new Error('No project by that name');
      await api.post(`/sales/rate-cards/${card.id}/apply`, { projectId: project.id, role });
    });

  return (
    <>
      <h1>Rate cards</h1>
      <p className="muted">
        What an hour costs, and since when. An indexation adds a rate rather than replacing
        one, so last year&rsquo;s price still has an answer. Applying a rate writes it onto a
        project — that is the only thing here that changes what gets invoiced.
      </p>

      <form onSubmit={(e) => void createCard(e)}>
        <div className="row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rate card name"
            aria-label="Rate card name"
            style={{ minWidth: 200 }}
          />
          <select
            value={cardClient}
            onChange={(e) => setCardClient(e.target.value)}
            aria-label="Rate card client"
          >
            <option value="">House rates (all clients)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy || !name.trim()}>
            Add card
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      {cards.length === 0 ? (
        <p className="muted">No rate cards yet.</p>
      ) : (
        cards.map((card) => (
          <section key={card.id}>
            <h2>
              {card.name}{' '}
              <span className="badge">
                {card.clientId
                  ? (clients.find((c) => c.id === card.clientId)?.name ?? 'client')
                  : 'house'}
              </span>
            </h2>

            {card.lines.length === 0 ? (
              <p className="muted">No rates yet.</p>
            ) : (
              <div className="grid-scroll">
                <table className="grid">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Role</th>
                      <th>Rate</th>
                      <th>In force from</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {card.lines.map((line) => {
                      const current = card.currentRates.some((r) => r.id === line.id);
                      return (
                        <tr key={line.id} className={current ? undefined : 'muted'}>
                          <td style={{ textAlign: 'left' }}>
                            {line.role}
                            {current && <span className="badge billed">current</span>}
                          </td>
                          <td>{money(line.rateCents)}</td>
                          <td>{line.effectiveFrom}</td>
                          <td>
                            {current && (
                              <button
                                className="link-button"
                                onClick={() => void applyToProject(card, line.role)}
                              >
                                apply to project
                              </button>
                            )}
                            <button
                              className="link-button destructive"
                              onClick={() =>
                                void act(() =>
                                  api.del(`/sales/rate-cards/${card.id}/rates/${line.id}`),
                                )
                              }
                            >
                              remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="row">
              <button className="link-button" onClick={() => void addRate(card)}>
                + add rate
              </button>
            </div>
          </section>
        ))
      )}
    </>
  );
}
