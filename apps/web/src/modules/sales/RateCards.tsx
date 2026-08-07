import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { api } from '../../lib/api.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useToast } from '../../shell/ui/Toast.js';
import type { Client, Project } from '../crm/types.js';
import { money } from './types.js';
import type { RateCard } from './contractTypes.js';
import { Empty } from '../../shell/ui/primitives.js';

/**
 * Rate cards.
 *
 * A card records what an hour costs and since when. It does not change what an invoice
 * bills on its own — applying a rate to a project is an explicit act, so an edit here can
 * never quietly alter a draft invoice.
 */
export function RateCards() {
  const { ask } = useDialog();
  const toast = useToast();
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

  /**
   * One dialog with typed fields, replacing three chained prompts.
   *
   * The prompts were not merely ugly. Each was free text, so `Number('thirty five')` is
   * NaN cents and a date typed as 12/03 never parsed — and browsers suppress prompts after
   * a few in a row, so the third one could simply not appear and the rate would be filed
   * with whatever the second returned.
   */
  const addRate = (card: RateCard) =>
    act(async () => {
      const values = await ask({
        title: 'Add a rate',
        body: 'Applies from the date given; earlier work keeps the rate in force at the time.',
        confirmLabel: 'Add rate',
        fields: [
          { name: 'role', label: 'Role', defaultValue: 'Consultant', required: true },
          {
            name: 'euros',
            label: 'Rate per hour (€)',
            type: 'number',
            step: '0.01',
            defaultValue: '35.00',
            required: true,
          },
          {
            name: 'from',
            label: 'In force from',
            type: 'date',
            defaultValue: new Date().toISOString().slice(0, 10),
            required: true,
          },
        ],
      });
      if (!values) return;
      await api.post(`/sales/rate-cards/${card.id}/rates`, {
        role: values.role.trim(),
        rateCents: Math.round(Number(values.euros) * 100),
        effectiveFrom: values.from,
      });
      toast.ok(`${values.role} rate added`);
    });

  /**
   * Pick the project, rather than retype its name.
   *
   * This asked for a project by exact name match against a list printed into the prompt —
   * so a trailing space, a different capitalisation, or a name you misremembered all
   * produced "No project by that name" after the work of typing it.
   */
  const applyToProject = (card: RateCard, role: string) =>
    act(async () => {
      const options = projects.filter((p) => !card.clientId || p.clientId === card.clientId);
      if (options.length === 0) throw new Error('No projects for this client');
      const values = await ask({
        title: `Apply the ${role} rate`,
        body: 'The project keeps this rate until it is changed again.',
        confirmLabel: 'Apply rate',
        fields: [
          {
            name: 'projectId',
            label: 'Project',
            type: 'select',
            defaultValue: options[0]?.id,
            options: options.map((p) => ({ value: p.id, label: p.name })),
          },
        ],
      });
      if (!values) return;
      await api.post(`/sales/rate-cards/${card.id}/apply`, {
        projectId: values.projectId,
        role,
      });
      toast.ok(`${role} rate applied to ${options.find((p) => p.id === values.projectId)?.name}`);
    });

  return (
    <>
      <PageHeader
        title="Rate cards"
        subtitle="What an hour costs, and since when. An indexation adds a rate rather than replacing one, so last year&rsquo;s price still has an answer. Applying a rate writes it onto a project — that is the only thing here that changes what gets invoiced."
      />

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
        <Empty>No rate cards yet.</Empty>
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
              <Empty>No rates yet.</Empty>
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
