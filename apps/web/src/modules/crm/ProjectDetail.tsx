import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EntityRef } from '@platform/contracts';
import { api } from '../../lib/api.js';
import { Links } from '../../shell/Links.js';
import { Timeline } from '../../shell/Timeline.js';
import {
  PROJECT_STATUSES,
  formatMoney,
  humanise,
  type Client,
  type Project,
} from './types.js';

export function ProjectDetail() {
  const { id = '' } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [candidates, setCandidates] = useState<EntityRef[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<Project>(`/crm/projects/${id}`)
      .then(async (p) => {
        setProject(p);
        setClient(await api.get<Client>(`/crm/clients/${p.clientId}`));
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
    Promise.all([api.get<Client[]>('/crm/clients'), api.get<Project[]>('/crm/projects')])
      .then(([cs, ps]) =>
        setCandidates([
          ...cs.map((c) => ref(c.id, 'client', c.name, `/crm/clients/${c.id}`)),
          ...ps.map((p) => ref(p.id, 'project', p.name, `/crm/projects/${p.id}`)),
        ]),
      )
      .catch(() => setCandidates([]));
  }, [id]);

  const setStatus = async (status: string) => {
    await api.patch(`/crm/projects/${id}`, { status });
    await load();
    setRefreshKey((k) => k + 1);
  };

  if (error) return <p className="error">{error}</p>;
  if (!project) return <p className="muted">Loading…</p>;

  return (
    <>
      <p>
        <Link to="/crm/projects">← Projects</Link>
        {client && (
          <>
            {' · '}
            <Link to={`/crm/clients/${client.id}`}>{client.name}</Link>
          </>
        )}
      </p>
      <h1>{project.name}</h1>

      <div className="row">
        <select value={project.status} onChange={(e) => void setStatus(e.target.value)}>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </select>
        <span className="badge">{humanise(project.billingModel)}</span>
      </div>

      <section>
        <h2>Commercials</h2>
        <ul className="cards">
          {project.billingModel === 'retainer' ? (
            <li>
              {formatMoney(project.retainerAmountCents, project.currency)} per{' '}
              {project.retainerPeriod}
            </li>
          ) : (
            <>
              {project.defaultRateCents != null && (
                <li>Rate: {formatMoney(project.defaultRateCents, project.currency)} / hour</li>
              )}
              {project.budgetAmountCents != null && (
                <li>
                  {project.billingModel === 'fixed_fee' ? 'Agreed price' : 'Budget cap'}:{' '}
                  {formatMoney(project.budgetAmountCents, project.currency)}
                </li>
              )}
              {project.budgetHours && <li>Budget: {project.budgetHours} hours</li>}
            </>
          )}
        </ul>
        <p className="muted">
          Hours logged against this project appear here once time registration lands in Phase 2.
        </p>
      </section>

      <section>
        <h2>Links</h2>
        <Links entityId={id} candidates={candidates} onChange={() => setRefreshKey((k) => k + 1)} />
      </section>

      <section>
        <h2>Timeline</h2>
        <Timeline entityId={id} refreshKey={refreshKey} />
      </section>
    </>
  );
}

const ref = (id: string, entityType: string, displayName: string, urlPath: string): EntityRef => ({
  id,
  entityType,
  displayName,
  urlPath,
  deleted: false,
});
