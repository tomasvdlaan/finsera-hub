import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { auditLog, entities, events, users } from '../../core/db/core.schema.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from './crm.manifest.js';
import { contacts, projectMembers, projects } from './crm.schema.js';
import { CrmService } from './crm.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

function build() {
  const manifests = new ManifestRegistry();
  manifests.register(crmManifest);
  manifests.seal();

  const registry = new RegistryService(testDb, manifests);
  const permissions = new PermissionService(testDb, manifests);
  const audit = new AuditService();
  const links = new LinkService(testDb, registry, permissions, audit, manifests);
  return new CrmService(testDb, registry, permissions, audit, new EventBus(manifests), links);
}

function links() {
  const manifests = new ManifestRegistry();
  manifests.register(crmManifest);
  manifests.seal();
  const registry = new RegistryService(testDb, manifests);
  const permissions = new PermissionService(testDb, manifests);
  return new LinkService(testDb, registry, permissions, new AuditService(), manifests);
}

describe('CrmService', () => {
  let crm: CrmService;

  beforeEach(async () => {
    await resetDb();
    // CRM tables live outside the core schema, so resetDb does not cover them.
    await truncate(sql`TRUNCATE crm.project_members, crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');
    crm = build();
  });

  // ── clients ──

  it('creates a client, registers it, audits, and publishes', async () => {
    const client = await crm.createClient(actor, { name: 'De Chocolaterie' });

    expect(client).toMatchObject({ name: 'De Chocolaterie', status: 'lead' });

    // The registry entry shares the row's id — the invariant everything else rests on.
    const [entity] = await testDb.select().from(entities).where(eq(entities.id, client.id));
    expect(entity).toMatchObject({
      entityType: 'client',
      owningModule: 'crm',
      displayName: 'De Chocolaterie',
    });

    const audits = await testDb.select().from(auditLog);
    expect(audits.map((a) => a.action)).toEqual(['client.create']);
    const published = await testDb.select().from(events);
    expect(published.map((e) => e.eventName)).toEqual(['client.created']);
  });

  it('defaults the owner to the acting user', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    expect(client.ownerId).toBe(actor.userId);
  });

  it('rejects an owner that is not a real user', async () => {
    // owner_id carries no cross-schema FK (modules stay droppable), so a bad reference
    // must be caught in the service or it sits in the table unnoticed.
    await expect(
      crm.createClient(actor, { name: 'Acme', ownerId: crypto.randomUUID() }),
    ).rejects.toThrow(/existing user/);
  });

  it('rejects a blank name', async () => {
    await expect(crm.createClient(actor, { name: '   ' })).rejects.toThrow(/required/);
  });

  it('moves a client through the pipeline and publishes the change', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    const updated = await crm.updateClient(actor, client.id, { status: 'proposal' });

    expect(updated.status).toBe('proposal');
    const names = (await testDb.select().from(events)).map((e) => e.eventName);
    expect(names).toContain('client.status_changed');
  });

  it('does not publish a status change when the status did not change', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    await crm.updateClient(actor, client.id, { notes: 'just a note' });

    const names = (await testDb.select().from(events)).map((e) => e.eventName);
    expect(names).not.toContain('client.status_changed');
  });

  it('keeps the registry display name in step with a rename', async () => {
    const client = await crm.createClient(actor, { name: 'Old Name' });
    await crm.updateClient(actor, client.id, { name: 'New Name' });

    // Links and timelines render the registry's copy; drift would show stale names
    // everywhere except the client's own page.
    const [entity] = await testDb.select().from(entities).where(eq(entities.id, client.id));
    expect(entity!.displayName).toBe('New Name');
  });

  it('filters by status and searches by name', async () => {
    await crm.createClient(actor, { name: 'Chocolaterie' });
    await crm.createClient(actor, { name: 'Bakkerij', status: 'active' });

    expect(await crm.listClients(actor, { status: 'active' })).toHaveLength(1);
    expect(await crm.listClients(actor, { query: 'choco' })).toHaveLength(1);
  });

  it('hides an archived client and marks the registry entry deleted', async () => {
    const client = await crm.createClient(actor, { name: 'Gone' });
    await crm.archiveClient(actor, client.id);

    expect(await crm.listClients(actor)).toHaveLength(0);
    const [entity] = await testDb.select().from(entities).where(eq(entities.id, client.id));
    expect(entity!.deletedAt).not.toBeNull(); // links must still resolve, struck through
  });

  // ── contacts ──

  it('creates a contact under a client', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    const contact = await crm.createContact(actor, {
      clientId: client.id,
      name: 'Jan Jansen',
      email: 'jan@acme.nl',
      isPrimary: true,
    });

    expect(contact).toMatchObject({ name: 'Jan Jansen', isPrimary: true });
    const [entity] = await testDb.select().from(entities).where(eq(entities.id, contact.id));
    expect(entity!.entityType).toBe('contact');
  });

  it('refuses a contact for a client that does not exist', async () => {
    await expect(
      crm.createContact(actor, { clientId: crypto.randomUUID(), name: 'Ghost' }),
    ).rejects.toThrow();
  });

  it('allows only one primary contact per client', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    await crm.createContact(actor, { clientId: client.id, name: 'First', isPrimary: true });
    await crm.createContact(actor, { clientId: client.id, name: 'Second', isPrimary: true });

    const rows = await testDb.select().from(contacts).where(eq(contacts.clientId, client.id));
    expect(rows.filter((c) => c.isPrimary).map((c) => c.name)).toEqual(['Second']);
  });

  // ── projects and billing models ──

  it('creates a time & materials project', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    const project = await crm.createProject(actor, {
      clientId: client.id,
      name: 'KPI dashboard',
      billingModel: 'time_and_materials',
      defaultRateCents: 12_500, // €125.00/hr — cents, never floats
      budgetHours: 80,
    });

    expect(project).toMatchObject({ billingModel: 'time_and_materials', defaultRateCents: 12_500 });
    const names = (await testDb.select().from(events)).map((e) => e.eventName);
    expect(names).toContain('project.created');
  });

  it('requires an amount for a fixed-fee project', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    await expect(
      crm.createProject(actor, { clientId: client.id, name: 'Rebuild', billingModel: 'fixed_fee' }),
    ).rejects.toThrow(/agreed amount/);
  });

  it('requires an amount and period for a retainer', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    await expect(
      crm.createProject(actor, {
        clientId: client.id,
        name: 'Support',
        billingModel: 'retainer',
        retainerAmountCents: 200_000,
      }),
    ).rejects.toThrow(/amount and a period/);
  });

  it('accepts a well-formed retainer', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    const project = await crm.createProject(actor, {
      clientId: client.id,
      name: 'BI support',
      billingModel: 'retainer',
      retainerAmountCents: 200_000, // €2000.00
      retainerPeriod: 'monthly',
    });
    expect(project).toMatchObject({ retainerAmountCents: 200_000, retainerPeriod: 'monthly' });
  });

  it('rejects an unknown billing model', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    await expect(
      crm.createProject(actor, {
        clientId: client.id,
        name: 'Odd',
        billingModel: 'barter' as never,
      }),
    ).rejects.toThrow(/billing model/);
  });

  it('enforces billing rules on update, not only on create', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    const project = await crm.createProject(actor, {
      clientId: client.id,
      name: 'Work',
      billingModel: 'time_and_materials',
      defaultRateCents: 10_000,
    });

    // Switching to fixed fee without a price would leave invoicing guessing.
    await expect(
      crm.updateProject(actor, project.id, { billingModel: 'fixed_fee' }),
    ).rejects.toThrow(/agreed amount/);
  });

  it('rolls everything back when the project insert fails', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    const before = await testDb.select().from(entities);

    await expect(
      crm.createProject(actor, {
        clientId: client.id,
        name: 'Doomed',
        billingModel: 'time_and_materials',
        defaultRateCents: -1, // violates the non-negative CHECK
      }),
    ).rejects.toThrow();

    // No orphan registry entry, no project row, no event announcing a change that
    // never happened.
    expect(await testDb.select().from(entities)).toHaveLength(before.length);
    expect(await testDb.select().from(projects)).toHaveLength(0);
    expect((await testDb.select().from(events)).map((e) => e.eventName)).not.toContain(
      'project.created',
    );
  });

  it('makes a project visible on its client timeline without a manual link', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    const project = await crm.createProject(actor, {
      clientId: client.id,
      name: 'Dashboard',
      billingModel: 'time_and_materials',
    });

    // project → client is structural, but the timeline is a generic core query over
    // links, so the module mirrors the relationship as one (Master §8.3). Without this
    // a client's own projects would be missing from their timeline.
    const linked = await links().linkedIds(actor, client.id);
    expect(linked).toContain(project.id);
  });

  it('assembles a client overview', async () => {
    const client = await crm.createClient(actor, { name: 'Acme' });
    await crm.createContact(actor, { clientId: client.id, name: 'Jan' });
    await crm.createProject(actor, {
      clientId: client.id,
      name: 'Dashboard',
      billingModel: 'time_and_materials',
    });

    const overview = await crm.getClientOverview(actor, client.id);
    expect(overview.client.name).toBe('Acme');
    expect(overview.contacts).toHaveLength(1);
    expect(overview.projects).toHaveLength(1);
  });

  // ── AI tool handlers ──

  it('flags AI-created leads in the audit trail', async () => {
    const result = await crm.createLead(actor, { name: 'Prospect BV' });

    const [row] = await testDb.select().from(auditLog).where(eq(auditLog.entityId, result.id));
    expect(row).toMatchObject({ action: 'client.create', aiInitiated: true });
  });

  it('exposes a compact shape to the assistant', async () => {
    await crm.createClient(actor, { name: 'Acme', status: 'active' });
    const result = await crm.searchClients(actor, { status: 'active' });
    expect(result.clients[0]).toEqual({
      id: expect.any(String),
      name: 'Acme',
      status: 'active',
    });
  });

  // ── permissions ──

  it('refuses a write without the capability', async () => {
    const manifests = new ManifestRegistry();
    manifests.register(crmManifest);
    manifests.seal();
    const denied = new (class extends PermissionService {
      override async can(a: Actor, capability: string) {
        return capability !== 'crm.clients.write' && super.can(a, capability);
      }
    })(testDb, manifests);

    const registry = new RegistryService(testDb, manifests);
    const audit = new AuditService();
    const restricted = new CrmService(
      testDb,
      registry,
      denied,
      audit,
      new EventBus(manifests),
      new LinkService(testDb, registry, denied, audit, manifests),
    );

    await expect(restricted.createClient(actor, { name: 'Nope' })).rejects.toThrow(/capability/);
  });
});

/**
 * Who is on a project.
 *
 * The rules worth pinning down are the ones a future edit could quietly break: that adding
 * somebody twice is not an error, that promoting a lead demotes the incumbent rather than
 * hitting the unique index, and — most of all — that taking somebody off a project does not
 * touch the work they already did. Membership is a statement about now; the hours and the
 * cards are the record, and rewriting that because somebody moved on is how a timesheet stops
 * matching an invoice.
 */
describe('CrmService — project membership', () => {
  let crm: CrmService;
  const member: Actor = { userId: crypto.randomUUID(), role: 'member' };
  const galang = crypto.randomUUID();
  const jeroen = crypto.randomUUID();
  let projectId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE crm.project_members, crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');
    await seedUser(member.userId, 'member');
    await seedUser(galang, 'member');
    await seedUser(jeroen, 'member');
    crm = build();

    const client = await crm.createClient(actor, { name: 'DocHorse' });
    const project = await crm.createProject(actor, {
      clientId: client.id,
      name: 'Power BI portal',
      billingModel: 'time_and_materials',
    });
    projectId = project.id;
  });

  it('puts somebody on a project and reads them back', async () => {
    const after = await crm.addMember(actor, projectId, { userId: galang });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ userId: galang, role: 'contributor' });
  });

  it('is idempotent — adding twice is somebody clicking twice', async () => {
    await crm.addMember(actor, projectId, { userId: galang });
    const after = await crm.addMember(actor, projectId, { userId: galang });
    expect(after).toHaveLength(1);
  });

  it('promotes a lead by demoting the incumbent, rather than refusing', async () => {
    await crm.addMember(actor, projectId, { userId: galang, role: 'lead' });
    const after = await crm.addMember(actor, projectId, { userId: jeroen, role: 'lead' });

    const leads = after.filter((m) => m.role === 'lead');
    expect(leads).toHaveLength(1);
    expect(leads[0]!.userId).toBe(jeroen);
    expect(after.find((m) => m.userId === galang)!.role).toBe('contributor');
  });

  it('lists the lead first, so the name that answers “who do I ask” is at the top', async () => {
    await crm.addMember(actor, projectId, { userId: galang });
    await crm.addMember(actor, projectId, { userId: jeroen, role: 'lead' });
    const after = await crm.listMembers(actor, projectId);
    expect(after[0]).toMatchObject({ userId: jeroen, role: 'lead' });
  });

  it('removing somebody who was never on it is not an error', async () => {
    const after = await crm.removeMember(actor, projectId, galang);
    expect(after).toHaveLength(0);
  });

  it('answers the other direction: every project one person is on', async () => {
    await crm.addMember(actor, projectId, { userId: galang, role: 'lead' });
    const mine = await crm.projectsFor(actor, galang);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ projectId, name: 'Power BI portal', clientName: 'DocHorse', role: 'lead' });
  });

  it('refuses to put somebody on a project who is no longer active', async () => {
    await testDb.update(users).set({ isActive: false }).where(eq(users.id, galang));
    await expect(crm.addMember(actor, projectId, { userId: galang })).rejects.toThrow(
      /no longer active/,
    );
  });

  it('refuses an id that is not a person at all', async () => {
    await expect(
      crm.addMember(actor, projectId, { userId: crypto.randomUUID() }),
    ).rejects.toThrow(/does not exist/);
  });

  it('lets a member read who is on a project, and refuses to let them change it', async () => {
    await crm.addMember(actor, projectId, { userId: galang });
    // Reading is how you know who to ask; deciding is the owner's job.
    await expect(crm.listMembers(member, projectId)).resolves.toHaveLength(1);
    await expect(crm.addMember(member, projectId, { userId: jeroen })).rejects.toThrow(
      /crm.projects.assign/,
    );
    await expect(crm.removeMember(member, projectId, galang)).rejects.toThrow(
      /crm.projects.assign/,
    );
  });

  it('carries the team on the list, but only when asked', async () => {
    await crm.addMember(actor, projectId, { userId: galang, role: 'lead' });

    // Absent, not empty: "nobody is on this" and "we did not ask" must stay different facts,
    // or a row renders "nobody yet" for a list that simply did not request it.
    const plain = await crm.listProjects(actor, {});
    expect(plain.every((r) => !('members' in r))).toBe(true);

    const withTeam = await crm.listProjects(actor, { withMembers: true });
    // `listProjects` returns a union — with members or without — so the narrowing is explicit.
    const mine = withTeam.find((r) => r.id === projectId) as unknown as {
      members: Array<{ userId: string; role: string }>;
    };
    expect(mine.members).toHaveLength(1);
    expect(mine.members[0]).toMatchObject({ userId: galang, role: 'lead' });
  });

  it('gives an empty team to a project nobody is on, rather than omitting the key', async () => {
    const withTeam = await crm.listProjects(actor, { withMembers: true });
    const mine = withTeam.find((r) => r.id === projectId) as unknown as { members: unknown[] };
    expect(mine.members).toEqual([]);
  });

  it('cascades when the project goes, and only then', async () => {
    await crm.addMember(actor, projectId, { userId: galang });
    await testDb.delete(projects).where(eq(projects.id, projectId));
    const left = await testDb.select().from(projectMembers).where(eq(projectMembers.projectId, projectId));
    expect(left).toHaveLength(0);
  });
});
