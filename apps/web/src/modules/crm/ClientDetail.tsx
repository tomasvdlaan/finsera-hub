import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Links } from '../../shell/Links.js';
import { Timeline } from '../../shell/Timeline.js';
import { DocumentsWidget } from '../docs/DocumentsWidget.js';
import { EditableField } from './EditableField.js';
import type { EntityRef } from '@platform/contracts';
import {
  CLIENT_STATUSES,
  formatMoney,
  humanise,
  type Client,
  type Contact,
  type Project,
} from './types.js';

interface Overview {
  client: Client;
  contacts: Contact[];
  projects: Project[];
}

/**
 * The 360° client view. Details and contacts come from CRM; Links and Timeline are core
 * components this module contributed no code to.
 */
export function ClientDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Overview | null>(null);
  const [candidates, setCandidates] = useState<EntityRef[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const load = () =>
    api
      .get<Overview>(`/crm/clients/${id}/overview`)
      .then(setData)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
    // Link candidates: other clients and all projects.
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
    await api.patch(`/crm/clients/${id}`, body);
    await load();
  };

  const archive = async () => {
    await api.del(`/crm/clients/${id}`);
    navigate('/crm/clients');
  };

  const setStatus = async (status: string) => {
    await api.patch(`/crm/clients/${id}`, { status });
    await load();
    setRefreshKey((k) => k + 1); // status changes publish an event → timeline moves
  };

  const addContact = async (e: FormEvent) => {
    e.preventDefault();
    if (!contactName.trim()) return;
    try {
      await api.post('/crm/contacts', {
        clientId: id,
        name: contactName.trim(),
        email: contactEmail.trim() || null,
        isPrimary: (data?.contacts.length ?? 0) === 0,
      });
      setContactName('');
      setContactEmail('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Only a failed load blanks the page; a rejected edit surfaces inline below.
  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  const { client, contacts, projects } = data;

  return (
    <>
      <p>
        <Link to="/crm/clients">← Clients</Link>
      </p>
      <h1>{client.name}</h1>

      <div className="row">
        <select value={client.status} onChange={(e) => void setStatus(e.target.value)}>
          {CLIENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </select>
        {client.website && (
          <a href={client.website} target="_blank" rel="noreferrer">
            visit site
          </a>
        )}
        <button className="link-button" onClick={() => void archive()}>
          archive client
        </button>
      </div>
      <EditableField
        label="Name"
        value={client.name}
        onSave={(v) => patch({ name: v })}
      />
      <EditableField
        label="Website"
        value={client.website}
        placeholder="https://…"
        onSave={(v) => patch({ website: v })}
      />
      <EditableField
        label="Notes"
        value={client.notes}
        placeholder="What you need to remember about this client"
        multiline
        onSave={(v) => patch({ notes: v })}
      />

      {error && <p className="error">{error}</p>}

      <section>
        <h2>Contacts</h2>
        {contacts.length === 0 ? (
          <p className="muted">No contacts yet.</p>
        ) : (
          <ul className="cards">
            {contacts.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                {c.isPrimary && <span className="badge">primary</span>}{' '}
                <span className="muted">
                  {[c.role, c.email, c.phone].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={(e) => void addContact(e)} className="row">
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Contact name"
            aria-label="Contact name"
          />
          <input
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="Email (optional)"
            aria-label="Contact email"
          />
          <button type="submit" disabled={!contactName.trim()}>
            Add contact
          </button>
        </form>
      </section>

      <section>
        <h2>Projects</h2>
        {projects.length === 0 ? (
          <p className="muted">No projects yet.</p>
        ) : (
          <ul className="cards">
            {projects.map((p) => (
              <li key={p.id}>
                <Link to={`/crm/projects/${p.id}`}>{p.name}</Link>{' '}
                <span className="badge">{humanise(p.billingModel)}</span>{' '}
                <span className="muted">
                  {humanise(p.status)}
                  {p.budgetAmountCents != null &&
                    ` · ${formatMoney(p.budgetAmountCents, p.currency)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Documents</h2>
        <DocumentsWidget clientId={id} />
      </section>

      <section>
        <h2>Links</h2>
        <Links entityId={id} candidates={candidates} onChange={() => setRefreshKey((k) => k + 1)} />
      </section>

      <section>
        <h2>Timeline</h2>
        <p className="muted">
          Assembled by the core from registry entries, links, and events — including activity on
          linked entities.
        </p>
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
