import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { scrumManifest } from '../scrum/scrum.manifest.js';
import { ScrumService } from '../scrum/scrum.service.js';
import { tasks } from '../scrum/scrum.schema.js';
import { timeManifest } from '../time/time.manifest.js';
import { TimeService } from '../time/time.service.js';
import { PortalProjection } from './portal.projection.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/**
 * What a client sees of the work, and what they must not.
 *
 * Two conditions have to hold together — the task is marked visible, and its project is
 * theirs — so both are tested apart as well as together. The field list is asserted
 * exactly, because a task carries several fields written for colleagues and the failure
 * mode is a description appearing on a client's screen, not an error.
 */
describe('PortalProjection.tasks', () => {
  let projection: PortalProjection;
  let scrum: ScrumService;
  let crm: CrmService;
  let mine: string;
  let theirs: string;
  let myProject: string;
  let theirProject: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE scrum.tasks, scrum.sprints, scrum.boards, time.entries,
      crm.project_members, crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');

    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, timeManifest, scrumManifest]) manifests.register(m);
    manifests.seal();
    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const bus = new EventBus(manifests);
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    const time = new TimeService(testDb, registry, permissions, audit, bus, links, crm);
    scrum = new ScrumService(testDb, registry, permissions, audit, bus, links, crm, time);
    projection = new PortalProjection(testDb, manifests);

    mine = (await crm.createClient(actor, { name: 'Duce', status: 'active' })).id;
    theirs = (await crm.createClient(actor, { name: 'DocHorse', status: 'active' })).id;
    myProject = (
      await crm.createProject(actor, { clientId: mine, name: 'Dashboard', billingModel: 'time_and_materials' })
    ).id;
    theirProject = (
      await crm.createProject(actor, { clientId: theirs, name: 'Theirs', billingModel: 'time_and_materials' })
    ).id;
  });

  const makeTask = async (projectId: string, title: string, visible: boolean) => {
    const task = await scrum.createTask(actor, { projectId, title });
    if (visible) await scrum.updateTask(actor, task.id, { clientVisible: true });
    return task.id;
  };

  it('shows nothing until somebody says so', async () => {
    await makeTask(myProject, 'Refactor the ingest job', false);
    // Off by default is the design: opting in means somebody decided, opting out would
    // mean somebody forgot, once, in public.
    expect(await projection.tasks({ clientId: mine })).toEqual([]);
  });

  it('shows a visible task, in the reduced form the manifest declares', async () => {
    await makeTask(myProject, 'Q3-rapportage opleveren', true);
    const [row] = (await projection.tasks({ clientId: mine })) as Array<Record<string, unknown>>;

    // Exact, not a superset. A field arriving here later would arrive on a client's screen.
    expect(Object.keys(row!).sort()).toEqual(
      ['completed_at', 'due_on', 'id', 'project_id', 'project_name', 'status', 'title', 'type'].sort(),
    );
    expect(row).toMatchObject({ title: 'Q3-rapportage opleveren', project_name: 'Dashboard' });
  });

  it('never carries the fields written for colleagues', async () => {
    const id = await makeTask(myProject, 'Iets doen', true);
    await scrum.updateTask(actor, id, {
      description: 'Marge is hier krap, niet met de klant delen',
      estimateMinutes: 240,
      assigneeId: actor.userId,
      labels: ['intern'],
    });

    const rows = await projection.tasks({ clientId: mine });
    const json = JSON.stringify(rows);
    for (const leak of ['Marge', '240', 'intern', actor.userId]) {
      expect(json, `${leak} reached the client`).not.toContain(leak);
    }
  });

  it('never shows a visible task belonging to another client', async () => {
    await makeTask(theirProject, 'Their visible task', true);
    // Visible is not the same as ours. Both conditions have to hold, and this is the half
    // that a "show me the visible tasks" query written in a hurry would drop.
    expect(await projection.tasks({ clientId: mine })).toEqual([]);
    expect(await projection.tasks({ clientId: theirs })).toHaveLength(1);
  });

  it('stops showing a task the moment it is hidden again', async () => {
    const id = await makeTask(myProject, 'Even zichtbaar', true);
    expect(await projection.tasks({ clientId: mine })).toHaveLength(1);
    await scrum.updateTask(actor, id, { clientVisible: false });
    expect(await projection.tasks({ clientId: mine })).toEqual([]);
  });

  it('hides an archived task rather than letting a client watch us delete things', async () => {
    const id = await makeTask(myProject, 'Vergissing', true);
    await testDb.update(tasks).set({ archivedAt: new Date() }).where(eq(tasks.id, id));
    expect(await projection.tasks({ clientId: mine })).toEqual([]);
  });

  it('refuses to serve tasks at all if the module stops declaring them', async () => {
    // `assertExposed` is what makes the manifest the decision rather than this query.
    const bare = new ManifestRegistry();
    for (const m of [crmManifest, timeManifest]) bare.register(m);
    bare.seal();
    const withoutScrum = new PortalProjection(testDb, bare);
    await expect(withoutScrum.tasks({ clientId: mine })).rejects.toThrow();
  });
});
