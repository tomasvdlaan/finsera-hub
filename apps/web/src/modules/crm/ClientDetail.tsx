import { useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { EntityWidgets } from '../../shell/ui/EntityWidgets.js';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Comments } from '../../shell/Comments.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useToast } from '../../shell/ui/Toast.js';
import { Links } from '../../shell/Links.js';
import { Timeline } from '../../shell/Timeline.js';
import { PortalPages } from '../portal/PortalPages.js';
import { PortalUsers, portalHost, portalUrl } from '../portal/PortalUsers.js';
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
import { Badge, Empty, Panel, Status } from '../../shell/ui/primitives.js';

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
  const { confirm } = useDialog();
  const toast = useToast();
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
          ...cs.map((c) => ref(c.id, 'client', c.name, `/clients/${c.id}`)),
          ...ps.map((p) => ref(p.id, 'project', p.name, `/projects/${p.id}`)),
        ]),
      )
      .catch(() => setCandidates([]));
  }, [id]);

  const patch = async (body: Record<string, unknown>) => {
    await api.patch(`/crm/clients/${id}`, body);
    await load();
  };

  const archive = async () => {
    // Fired immediately before, from the same `.row` as the status dropdown — so a
    // misclick one control to the right archived the client with no way back.
    const go = await confirm({
      title: `Archive ${client?.name ?? 'this client'}?`,
      body: 'They disappear from lists and from the pickers on new work. Their invoices, quotes and history are kept.',
      confirmLabel: 'Archive client',
      destructive: true,
    });
    if (!go) return;
    await api.del(`/crm/clients/${id}`);
    toast.ok(`${client?.name ?? 'Client'} archived`);
    navigate('/clients');
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
      <PageHeader
        title={client.name}
        back={{ to: '/crm/clients', label: 'Clients' }}
        subtitle={
          client.portalSlug ? (
            <>
              Their portal is at{' '}
              <a href={portalUrl(client.portalSlug)} target="_blank" rel="noreferrer">
                {portalHost(client.portalSlug)}
              </a>
            </>
          ) : (
            'No portal address yet — set one under Client portal.'
          )
        }
        meta={
          <>
            <Status value={client.status} />
            {client.website && (
              <a href={client.website} target="_blank" rel="noreferrer">
                {client.website.replace(/^https?:\/\//, '')}
              </a>
            )}
            <span className="muted">
              {contacts.length} contact{contacts.length === 1 ? '' : 's'} · {projects.length}{' '}
              project{projects.length === 1 ? '' : 's'}
            </span>
          </>
        }
        actions={
          <>
            {/* Read-only, audited, and served by the same projection the portal uses — so
                what it shows is what this client actually gets, not an approximation. */}
            <Link className="act" to={`/clients/${client.id}/portal`}>
              View their portal
            </Link>
            <button className="act" data-variant="danger" onClick={() => void archive()}>
              Archive
            </button>
          </>
        }
      />

      {error && <p className="error">{error}</p>}

      {/*
        Two columns of facts, because they are read for different reasons.

        Everything here used to be one stack: thirteen fields, the status control, two portal
        notes and an archive button, in the order they were written rather than in any order
        anybody reads them. Who this client is and what an invoice to them needs are separate
        questions, and separating them is most of what makes the page shorter than a screen
        and a half.
      */}
      <Panel span={6} title="Details">
        <div className="kv-list">
          <div className="kv">
            <span className="kv-label">Status</span>
            <span className="kv-value">
              <select
                value={client.status}
                onChange={(e) => void setStatus(e.target.value)}
                aria-label="Client status"
              >
                {CLIENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {humanise(s)}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <EditableField label="Name" value={client.name} onSave={(v) => patch({ name: v })} />
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
        </div>
      </Panel>

      <Panel
        span={6}
        title="Billing details"
        sub="What an invoice legally needs. Reverse charge additionally requires the VAT number."
      >
        <div className="kv-list">
          <EditableField
            label="Legal name"
            value={client.legalName}
            placeholder="As registered at the KvK"
            onSave={(v) => patch({ legalName: v })}
          />
          <EditableField
            label="Invoice address"
            value={client.invoiceAddress}
            multiline
            onSave={(v) => patch({ invoiceAddress: v })}
          />
          <EditableField
            label="Invoice email"
            value={client.invoiceEmail}
            onSave={(v) => patch({ invoiceEmail: v })}
          />
          <EditableField label="KvK" value={client.kvkNumber} onSave={(v) => patch({ kvkNumber: v })} />
          <EditableField
            label="VAT number"
            value={client.vatNumber}
            placeholder="NL…B01 / DE…"
            onSave={(v) => patch({ vatNumber: v })}
          />
          <EditableField
            label="Country"
            value={client.countryCode}
            placeholder="NL"
            onSave={(v) => patch({ countryCode: v ?? 'NL' })}
          />
          <EditableField
            label="Payment terms"
            value={client.paymentTermsDays ? `${client.paymentTermsDays} days` : null}
            placeholder="30"
            onSave={(v) => patch({ paymentTermsDays: v ? Number(v.replace(/\D/g, '')) : 30 })}
          />
          <div className="kv">
            <span className="kv-label">VAT treatment</span>
            <span className="kv-value">
              <select
                value={client.vatTreatment}
                onChange={(e) => void patch({ vatTreatment: e.target.value })}
                aria-label="VAT treatment"
              >
                <option value="domestic_21">Dutch client — 21% BTW</option>
                <option value="reverse_charge">EU client — BTW verlegd</option>
                <option value="outside_eu">Outside EU — out of scope</option>
              </select>
            </span>
          </div>
        </div>
      </Panel>

      <Panel span={6} title="Contacts">
        {contacts.length === 0 ? (
          <Empty>No contacts yet.</Empty>
        ) : (
          <ul className="cards">
            {contacts.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                {c.isPrimary && <Badge>primary</Badge>}{' '}
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
      </Panel>

      <Panel span={6} title="Projects">
        {projects.length === 0 ? (
          <Empty>No projects yet.</Empty>
        ) : (
          <ul className="cards">
            {projects.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`}>{p.name}</Link>{' '}
                <Badge>{humanise(p.billingModel)}</Badge>{' '}
                <span className="muted">
                  {humanise(p.status)}
                  {p.budgetAmountCents != null &&
                    ` · ${formatMoney(p.budgetAmountCents, p.currency)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/*
        Whatever the installed modules have to say about this client.

        Five widget components used to be imported by name here, which meant CRM had to know
        that billing, sales, docs and meetings exist — the exact coupling every manifest in
        this codebase is arranged to avoid, sitting in one of the two pages people open most.
      */}
      <EntityWidgets entityId={id} entityType="client" />

      {/*
        One region for the portal, because it was three.

        The address and the welcome line sat at the top of the page among the CRM fields, who
        may sign in sat two thirds down, and what they can see sat below that — three places
        to look for one subject, and the portal address printed twice on the way. Together
        they answer one question in order: where it is, who gets in, what is in there.
      */}
      <Panel
        title="Client portal"
        sub="Their own address, who may sign in to it, and what they find when they do."
      >
        <div className="kv-list">
          <EditableField
            label="Portal address"
            value={client.portalSlug}
            placeholder="duce  →  duce.finsera.nl"
            onSave={(v) => patch({ portalSlug: v })}
          />
          {client.portalSlug && (
            <EditableField
              label="Welcome line"
              value={client.portalWelcome}
              placeholder="A line they see when they open their portal"
              multiline
              onSave={(v) => patch({ portalWelcome: v })}
            />
          )}
        </div>
        {client.portalSlug && (
          <p className="muted">Changing the address breaks links they already have.</p>
        )}

        <PortalUsers clientId={client.id} clientName={client.name} portalSlug={client.portalSlug} />
        <PortalPages clientId={client.id} portalSlug={client.portalSlug} />
      </Panel>

      <Panel title="Discussion">
        <Comments entityId={id} />
      </Panel>

      <Panel span={6} title="Links">
        <Links entityId={id} candidates={candidates} onChange={() => setRefreshKey((k) => k + 1)} />
      </Panel>

      <Panel
        span={6}
        title="Timeline"
        sub="Assembled by the core from registry entries, links, and events — including activity on linked entities."
      >
        <Timeline entityId={id} refreshKey={refreshKey} />
      </Panel>
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
