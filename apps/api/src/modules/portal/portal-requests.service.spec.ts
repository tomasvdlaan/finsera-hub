import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { timeManifest } from '../time/time.manifest.js';
import { TimeService } from '../time/time.service.js';
import { CrmService } from '../crm/crm.service.js';
import { scrumManifest } from '../scrum/scrum.manifest.js';
import { ScrumService } from '../scrum/scrum.service.js';
import { PortalRequestsService } from './portal-requests.service.js';
import { portalManifest } from './portal.manifest.js';
import type { PortalVisitor } from './portal.projection.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

describe('PortalRequestsService', () => {
  let requests: PortalRequestsService;
  let crm: CrmService;
  let mine: string;
  let theirs: string;
  let visitor: PortalVisitor;

  beforeEach(async () => {
    await resetDb();
    await testDb.execute(
      sql`TRUNCATE portal.requests, portal.users, scrum.tasks, time.entries,
                   crm.projects, crm.clients CASCADE`,
    );
    await seedUser(actor.userId, 'admin');

    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, timeManifest, scrumManifest, portalManifest]) {
      manifests.register(m);
    }
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, permissions, audit);
    const bus = new EventBus(manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    const time = new TimeService(testDb, registry, permissions, audit, bus, links, crm);
    const scrum = new ScrumService(testDb, registry, permissions, audit, bus, links, crm, time);
    await Promise.all([
      crm.ensureReportingViews(),
      time.ensureReportingViews(),
      scrum.ensureReportingViews?.(),
    ]);

    requests = new PortalRequestsService(testDb, audit, scrum);

    mine = (await crm.createClient(actor, { name: 'My client', status: 'active' })).id;
    theirs = (await crm.createClient(actor, { name: 'Another', status: 'active' })).id;
    visitor = { portalUserId: crypto.randomUUID(), clientId: mine, email: 'me@myclient.nl' };
  });

  const submit = (over: Partial<{ subject: string; body: string; projectId: string }> = {}) =>
    requests.submit(visitor, { subject: 'Een vraag', body: 'Kunnen jullie ook…', ...over });

  it('records a request against the client who asked', async () => {
    const { id, status } = await submit();
    expect(status).toBe('open');

    const { rows } = await testDb.execute(sql`SELECT client_id, portal_user_id FROM portal.requests`);
    expect(rows[0]).toMatchObject({ client_id: mine, portal_user_id: visitor.portalUserId });
    expect(id).toBeTruthy();
  });

  it('refuses empty input', async () => {
    await expect(submit({ subject: '   ' })).rejects.toThrow(/onderwerp/i);
    await expect(submit({ body: '' })).rejects.toThrow(/onderwerp|bericht/i);
  });

  it('refuses text long enough to be an attack rather than a request', async () => {
    await expect(submit({ body: 'x'.repeat(5_001) })).rejects.toThrow(/5000/);
    await expect(submit({ subject: 'x'.repeat(201) })).rejects.toThrow(/200/);
  });

  it('refuses a project belonging to another client', async () => {
    const notMine = await crm.createProject(actor, {
      clientId: theirs, name: 'Theirs', billingModel: 'time_and_materials',
    });
    // The one field on this endpoint that arrives from the request and points at a row.
    await expect(submit({ projectId: notMine.id })).rejects.toThrow(/Onbekend project/);
  });

  it('accepts a project the client actually has', async () => {
    const ours = await crm.createProject(actor, {
      clientId: mine, name: 'Ours', billingModel: 'time_and_materials',
    });
    await expect(submit({ projectId: ours.id })).resolves.toMatchObject({ status: 'open' });
  });

  it('stops a client filling the table', async () => {
    for (let i = 0; i < 10; i++) await submit({ subject: `Vraag ${i}` });
    // Counted from stored rows rather than memory: a limiter that resets when the process
    // does is not much of a limiter.
    await expect(submit()).rejects.toThrow(/over een uur/);
  });

  it('limits per portal user, not globally', async () => {
    for (let i = 0; i < 10; i++) await submit({ subject: `Vraag ${i}` });

    const other: PortalVisitor = {
      portalUserId: crypto.randomUUID(), clientId: theirs, email: 'other@another.nl',
    };
    // One noisy client must not be able to mute everybody else's form.
    await expect(
      requests.submit(other, { subject: 'Iets anders', body: 'Vraag' }),
    ).resolves.toMatchObject({ status: 'open' });
  });

  // ── triage ──

  it('becomes a task only when someone converts it, and attributes the words', async () => {
    const project = await crm.createProject(actor, {
      clientId: mine, name: 'Ours', billingModel: 'time_and_materials',
    });
    const { id } = await submit({ body: 'Graag ook een extra rapportage.' });

    // Nothing on the board until a person has read it — the reason a request is not a task.
    expect((await testDb.execute(sql`SELECT 1 FROM scrum.tasks`)).rows).toHaveLength(0);

    const result = await requests.convert(actor, id, { projectId: project.id });
    const { rows } = await testDb.execute(
      sql`SELECT title, description FROM scrum.tasks WHERE id = ${result.taskId}`,
    );
    const task = rows[0] as { title: string; description: string };
    expect(task.title).toBe('Een vraag');
    // Attributed rather than presented as ours, so anyone — or anything — reading the
    // board can tell these are a client's words.
    expect(task.description).toContain('Verzoek van de klant');
    expect(task.description).toContain('Graag ook een extra rapportage.');
  });

  it('cannot convert the same request twice', async () => {
    const project = await crm.createProject(actor, {
      clientId: mine, name: 'Ours', billingModel: 'time_and_materials',
    });
    const { id } = await submit();
    await requests.convert(actor, id, { projectId: project.id });

    await expect(requests.convert(actor, id, { projectId: project.id })).rejects.toThrow(
      /No such open request/,
    );
  });

  it('cannot convert a declined request', async () => {
    const project = await crm.createProject(actor, {
      clientId: mine, name: 'Ours', billingModel: 'time_and_materials',
    });
    const { id } = await submit();
    await requests.decline(actor, id);

    await expect(requests.convert(actor, id, { projectId: project.id })).rejects.toThrow(
      /No such open request/,
    );
  });

  it('shows a client their own requests and nobody else’s', async () => {
    await submit({ subject: 'Mijn vraag' });
    await requests.submit(
      { portalUserId: crypto.randomUUID(), clientId: theirs, email: 'other@another.nl' },
      { subject: 'Hun vraag', body: 'Iets' },
    );

    const mineOnly = await requests.forClient(visitor);
    expect(mineOnly.map((r) => r.subject)).toEqual(['Mijn vraag']);
  });

  it('drops out of the triage list once handled', async () => {
    const { id } = await submit();
    expect(await requests.open()).toHaveLength(1);
    await requests.decline(actor, id);
    expect(await requests.open()).toHaveLength(0);
  });
});
