import { useEffect, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Link, useParams } from 'react-router-dom';
import type { EntityRef } from '@platform/contracts';
import { api } from '../../lib/api.js';
import { cents, euros } from '../../lib/money.js';
import { Comments } from '../../shell/Comments.js';
import { Links } from '../../shell/Links.js';
import { Timeline } from '../../shell/Timeline.js';
import { DocumentsWidget } from '../docs/DocumentsWidget.js';
import { OpenTasksWidget } from '../scrum/OpenTasksWidget.js';
import { ProjectBurn } from '../time/ProjectBurn.js';
import { EditableField } from './EditableField.js';
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

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api.patch(`/crm/projects/${id}`, body);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Euro string → integer cents. Money never becomes a float on the way to the API. */

  const setStatus = async (status: string) => {
    await api.patch(`/crm/projects/${id}`, { status });
    await load();
    setRefreshKey((k) => k + 1);
  };

  // Only a failed load blanks the page. A rejected edit (e.g. clearing a fixed-fee
  // price) must surface inline, with the record still on screen.
  if (!project) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  return (
    <>
      <PageHeader
        title={project.name}
        back={{ to: "/crm/projects", label: 'Projects' }}
        meta={
          <>
          {client && (
            <Link to={`/clients/${client.id}`}>{client.name}</Link>
          )}
          </>
        }
      />

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

      <EditableField label="Name" value={project.name} onSave={(v) => patch({ name: v })} />
      <EditableField
        label="Starts on"
        value={project.startsOn}
        placeholder="YYYY-MM-DD"
        onSave={(v) => patch({ startsOn: v })}
      />
      <EditableField
        label="Ends on"
        value={project.endsOn}
        placeholder="YYYY-MM-DD"
        onSave={(v) => patch({ endsOn: v })}
      />

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
        {project.billingModel === 'retainer' ? (
          <EditableField
            label="Retainer €"
            value={euros(project.retainerAmountCents)}
            onSave={(v) => patch({ retainerAmountCents: cents(v) })}
          />
        ) : (
          <>
            <EditableField
              label="Rate €/hr"
              value={euros(project.defaultRateCents)}
              onSave={(v) => patch({ defaultRateCents: cents(v) })}
            />
            <EditableField
              label={project.billingModel === 'fixed_fee' ? 'Agreed price €' : 'Budget cap €'}
              value={euros(project.budgetAmountCents)}
              onSave={(v) => patch({ budgetAmountCents: cents(v) })}
            />
            <EditableField
              label="Budget hours"
              value={project.budgetHours}
              onSave={(v) => patch({ budgetHours: v ? Number(v) : null })}
            />
          </>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section>
        <h2>Budget burn</h2>
        <p className="muted">
          Contributed by the Time module through its manifest — this page gained the widget
          without CRM changing.
        </p>
        <ProjectBurn projectId={id} />
      </section>

      <section>
        <h2>Tasks</h2>
        <OpenTasksWidget projectId={id} />
      </section>

      <section>
        <h2>Documents</h2>
        <DocumentsWidget projectId={id} />
      </section>

      <section>
        <h2>Discussion</h2>
        <Comments entityId={id} />
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
