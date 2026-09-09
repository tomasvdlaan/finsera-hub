import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { EntityRef } from '@platform/contracts';
import { api } from '../../lib/api.js';
import { Comments } from '../../shell/Comments.js';
import { Links } from '../../shell/Links.js';
import { Timeline } from '../../shell/Timeline.js';
import { PageHeader, SubNav } from '../../shell/ui/layout.js';
import { EntityWidgets } from '../../shell/ui/EntityWidgets.js';
import { DataTable, Skeleton } from '../../shell/ui/data.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useToast } from '../../shell/ui/Toast.js';
import { Avatar, Badge, Empty, Panel, Status } from '../../shell/ui/primitives.js';
import { PortalPages } from '../portal/PortalPages.js';
import { PortalUsers, portalHost, portalUrl } from '../portal/PortalUsers.js';
import { EditableField } from './EditableField.js';
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

/** What each tab is for, in the order the questions get asked. */
const TABS = [
  { key: '', label: 'Overview' },
  { key: 'billing', label: 'Billing' },
  { key: 'access', label: 'Portal access' },
  { key: 'activity', label: 'Activity' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * The 360° client view.
 *
 * Everything here used to be one column: identity, billing, five module widgets, who may sign
 * in to the portal, what content they can see, contacts, projects, discussion, links and a
 * timeline — nine subjects, a screen and a half tall, in the order they happened to be
 * written. A page that long is not read, it is scrolled past, and the things people came for
 * (who do we talk to; is anything outstanding) sat below the things nobody edits twice a year.
 *
 * Four tabs, because the page answers four different questions and only one of them at a time:
 *
 * - **Overview** — who this client is and what is live: contacts, projects, and whatever the
 *   installed modules have to say about them.
 * - **Billing** — what an invoice to them legally needs. Read when writing one, not otherwise.
 * - **Portal access** — their own address, who may sign in, and what they find there. A large
 *   administrative surface of its own, and the only part of this page that grants anybody
 *   anything.
 * - **Activity** — what was said, what it is linked to, and what happened.
 *
 * Tabs are routes rather than state, so a colleague can be sent to the billing details of a
 * client rather than to the client, and the back button undoes a tab change like it undoes
 * everything else. `/clients/:id/portal` was already taken by the portal preview — the page
 * that shows what the client sees — which is why this one is `access`.
 */
export function ClientDetail() {
  const { confirm, ask } = useDialog();
  const toast = useToast();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [data, setData] = useState<Overview | null>(null);
  const [candidates, setCandidates] = useState<EntityRef[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // The segment after the id, which is '' on the overview.
  const tab = (pathname.split('/')[3] ?? '') as TabKey;

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
      title: `Archive ${data?.client.name ?? 'this client'}?`,
      body: 'They disappear from lists and from the pickers on new work. Their invoices, quotes and history are kept.',
      confirmLabel: 'Archive client',
      destructive: true,
    });
    if (!go) return;
    await api.del(`/crm/clients/${id}`);
    toast.ok(`${data?.client.name ?? 'Client'} archived`);
    navigate('/clients');
  };

  /*
   * A contact is added in a dialog rather than in a form sitting under the list.
   *
   * The inline form was two inputs and a button, permanently occupying the bottom of the
   * panel whether or not anybody was adding anyone — and it could only ever capture a name
   * and an email, because a third and fourth input would have made the panel mostly form.
   * The API has taken a role and a phone number all along.
   */
  const addContact = async () => {
    const got = await ask({
      title: 'Add a contact',
      body: 'Somebody at this client worth having a name for. The first one becomes the primary contact.',
      confirmLabel: 'Add contact',
      fields: [
        { name: 'name', label: 'Name', required: true, placeholder: 'Danielle Dumfries' },
        { name: 'role', label: 'Role', placeholder: 'Finance, operations, …' },
        { name: 'email', label: 'Email', placeholder: 'name@client.nl' },
        { name: 'phone', label: 'Phone' },
      ],
    });
    if (!got?.name.trim()) return;
    try {
      await api.post('/crm/contacts', {
        clientId: id,
        name: got.name.trim(),
        role: got.role.trim() || null,
        email: got.email.trim() || null,
        phone: got.phone.trim() || null,
        isPrimary: (data?.contacts.length ?? 0) === 0,
      });
      await load();
    } catch (err) {
      toast.fail((err as Error).message);
    }
  };

  /*
   * Removing one was possible in the API and impossible in the interface, so a contact who
   * left the client stayed on their page permanently.
   */
  const removeContact = async (contact: Contact) => {
    const go = await confirm({
      title: `Remove ${contact.name}?`,
      body: 'They come off this client. Anything they are already on keeps their name.',
      confirmLabel: 'Remove contact',
      destructive: true,
    });
    if (!go) return;
    try {
      await api.del(`/crm/contacts/${contact.id}`);
      await load();
    } catch (err) {
      toast.fail((err as Error).message);
    }
  };

  if (!data) return error ? <p className="error">{error}</p> : <Skeleton height="18rem" />;
  const { client, contacts, projects } = data;

  const setStatus = async (status: string) => {
    await patch({ status });
    setRefreshKey((k) => k + 1); // status changes publish an event → timeline moves
  };

  return (
    <>
      {/* `/crm/clients` — the module's name in the path — is not a route: the list is at
          `/clients`, so the one link on this page that went up was a 404. */}
      <PageHeader
        title={client.name}
        back={{ to: '/clients', label: 'Clients' }}
        subtitle={
          client.portalSlug ? (
            <>
              Their portal is at{' '}
              <a href={portalUrl(client.portalSlug)} target="_blank" rel="noreferrer">
                {portalHost(client.portalSlug)}
              </a>
            </>
          ) : (
            'No portal address yet — one can be given under Portal access.'
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
              {count(contacts.length, 'contact')} · {count(projects.length, 'project')}
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
        tabs={
          <SubNav
            items={TABS.map((t) => ({
              label: t.label,
              to: t.key ? `/clients/${id}/${t.key}` : `/clients/${id}`,
            }))}
          />
        }
      />

      {error && <p className="error">{error}</p>}

      {tab === '' && (
        <>
          <Panel span={6} title="About">
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
            title="Contacts"
            action={
              <button className="act" onClick={() => void addContact()}>
                Add contact
              </button>
            }
          >
            {contacts.length === 0 ? (
              <Empty
                action={
                  <button className="act" data-variant="primary" onClick={() => void addContact()}>
                    Add the first contact
                  </button>
                }
              >
                Nobody here yet. A client with no name attached is a client somebody has to ask
                a colleague about.
              </Empty>
            ) : (
              <ul className="people-list">
                {contacts.map((c) => (
                  <li key={c.id}>
                    <Avatar name={c.name} id={c.id} />
                    <span className="people-text">
                      <span className="people-name">
                        {c.name}
                        {c.isPrimary && <Badge tone="brand">primary</Badge>}
                      </span>
                      <small className="muted">
                        {[c.role, c.email, c.phone].filter(Boolean).join(' · ') || 'No details'}
                      </small>
                    </span>
                    <button
                      className="act people-remove"
                      onClick={() => void removeContact(c)}
                      aria-label={`Remove ${c.name}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Projects">
            <DataTable
              caption="Projects for this client"
              rows={projects}
              rowKey={(p) => p.id}
              empty={<Empty>No projects yet.</Empty>}
              columns={[
                {
                  key: 'name',
                  header: 'Project',
                  render: (p) => <Link to={`/projects/${p.id}`}>{p.name}</Link>,
                },
                { key: 'status', header: 'Status', render: (p) => <Status value={p.status} /> },
                {
                  key: 'model',
                  header: 'Billing',
                  hideBelow: 'sm',
                  render: (p) => <span className="muted">{humanise(p.billingModel)}</span>,
                },
                {
                  key: 'budget',
                  header: 'Budget',
                  align: 'num',
                  render: (p) =>
                    p.budgetAmountCents == null ? (
                      <span className="muted">—</span>
                    ) : (
                      formatMoney(p.budgetAmountCents, p.currency)
                    ),
                },
              ]}
            />
          </Panel>

          {/*
            Whatever the installed modules have to say about this client.

            Five widget components used to be imported by name here, which meant CRM had to
            know that billing, sales, docs and meetings exist — the exact coupling every
            manifest in this codebase is arranged to avoid, sitting in one of the two pages
            people open most.
          */}
          <EntityWidgets entityId={id} entityType="client" />
        </>
      )}

      {tab === 'billing' && (
        <>
          <Panel
            span={6}
            title="Who to invoice"
            sub="What an invoice legally needs, and where it goes."
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
              <EditableField
                label="Payment terms"
                value={client.paymentTermsDays ? `${client.paymentTermsDays} days` : null}
                placeholder="30"
                onSave={(v) => patch({ paymentTermsDays: v ? Number(v.replace(/\D/g, '')) : 30 })}
              />
            </div>
          </Panel>

          <Panel
            span={6}
            title="Tax"
            sub="Reverse charge additionally requires the VAT number."
          >
            <div className="kv-list">
              <EditableField
                label="KvK"
                value={client.kvkNumber}
                onSave={(v) => patch({ kvkNumber: v })}
              />
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
        </>
      )}

      {tab === 'access' && (
        <>
          <Panel
            span={6}
            title="Their address"
            sub="A portal of their own, at a name that is theirs."
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
          </Panel>

          <PortalUsers clientId={client.id} clientName={client.name} portalSlug={client.portalSlug} />
          <PortalPages clientId={client.id} portalSlug={client.portalSlug} />
        </>
      )}

      {tab === 'activity' && (
        <>
          <Panel span={7} title="Discussion">
            <Comments entityId={id} />
          </Panel>

          <Panel
            span={5}
            title="Timeline"
            sub="Assembled by the core from registry entries, links, and events — including activity on linked entities."
          >
            <Timeline entityId={id} refreshKey={refreshKey} />
          </Panel>

          <Panel title="Links">
            <Links
              entityId={id}
              candidates={candidates}
              onChange={() => setRefreshKey((k) => k + 1)}
            />
          </Panel>
        </>
      )}
    </>
  );
}

/** "1 contact", "3 contacts" — the plural nobody should be writing at the call site. */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

const ref = (id: string, entityType: string, displayName: string, urlPath: string): EntityRef => ({
  id,
  entityType,
  displayName,
  urlPath,
  deleted: false,
});
