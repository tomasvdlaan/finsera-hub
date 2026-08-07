import { useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Comments } from '../../shell/Comments.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useToast } from '../../shell/ui/Toast.js';
import { Links } from '../../shell/Links.js';
import { Timeline } from '../../shell/Timeline.js';
import { ClientInvoicesWidget } from '../billing/ClientInvoicesWidget.js';
import { ClientNotesWidget } from '../meetings/ClientNotesWidget.js';
import { ClientContractsWidget } from '../sales/ClientContractsWidget.js';
import { ClientQuotesWidget } from '../sales/ClientQuotesWidget.js';
import { DocumentsWidget } from '../docs/DocumentsWidget.js';
import { PortalUsers } from '../portal/PortalUsers.js';
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
import { Empty } from '../../shell/ui/primitives.js';

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
        back={{ to: "/crm/clients", label: 'Clients' }}
      />

      <p className="muted">
        {/* Read-only, audited, and served by the same projection the portal uses — so what
            it shows is what this client actually gets, not an approximation of it. */}
        <Link to={`/clients/${client.id}/portal`}>View their client portal →</Link>
      </p>

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
        <button className="link-button destructive" onClick={() => void archive()}>
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
        <h2>Billing details</h2>
        <p className="muted">
          What an invoice legally needs. Reverse charge additionally requires the VAT number.
        </p>
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
          label="Payment terms (days)"
          value={String(client.paymentTermsDays)}
          onSave={(v) => patch({ paymentTermsDays: v ? Number(v) : 30 })}
        />
        <EditableField
          label="Invoice email"
          value={client.invoiceEmail}
          onSave={(v) => patch({ invoiceEmail: v })}
        />
        <div className="row">
          <span className="muted">VAT treatment:</span>
          <select
            value={client.vatTreatment}
            onChange={(e) => void patch({ vatTreatment: e.target.value })}
            aria-label="VAT treatment"
          >
            <option value="domestic_21">Dutch client — 21% BTW</option>
            <option value="reverse_charge">EU client — BTW verlegd</option>
            <option value="outside_eu">Outside EU — out of scope</option>
          </select>
        </div>
      </section>

      <section>
        <h2>Meetings</h2>
        <ClientNotesWidget clientId={id} />
      </section>

      <section data-span={6}>
        <h2>Contracts</h2>
        <ClientContractsWidget clientId={id} />
      </section>

      <section data-span={6}>
        <h2>Quotes</h2>
        <ClientQuotesWidget clientId={id} />
      </section>

      <section data-span={6}>
        <h2>Invoices</h2>
        <ClientInvoicesWidget clientId={id} />
      </section>

      <section>
        <PortalUsers clientId={client.id} />
      </section>

      <section data-span={6}>
        <h2>Contacts</h2>
        {contacts.length === 0 ? (
          <Empty>No contacts yet.</Empty>
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

      <section data-span={6}>
        <h2>Projects</h2>
        {projects.length === 0 ? (
          <Empty>No projects yet.</Empty>
        ) : (
          <ul className="cards">
            {projects.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`}>{p.name}</Link>{' '}
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

      <section data-span={6}>
        <h2>Documents</h2>
        <DocumentsWidget clientId={id} />
      </section>

      <section>
        <h2>Discussion</h2>
        <Comments entityId={id} />
      </section>

      <section data-span={6}>
        <h2>Links</h2>
        <Links entityId={id} candidates={candidates} onChange={() => setRefreshKey((k) => k + 1)} />
      </section>

      <section data-span={6}>
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
