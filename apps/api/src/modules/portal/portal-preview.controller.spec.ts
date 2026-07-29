import { beforeEach, describe, expect, it } from 'vitest';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Actor } from '@platform/contracts';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { IS_PUBLIC } from '../../core/auth/public.decorator.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { PortalPreviewController } from './portal-preview.controller.js';
import type { PortalRequestsService } from './portal-requests.service.js';
import { portalManifest } from './portal.manifest.js';
import { PortalProjection } from './portal.projection.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const member: Actor = { userId: crypto.randomUUID(), role: 'member' };

describe('PortalPreviewController wiring', () => {
  const proto = PortalPreviewController.prototype as unknown as Record<string, object>;
  const routes = Object.getOwnPropertyNames(proto).filter(
    (name) =>
      name !== 'constructor' &&
      Reflect.getMetadata(PATH_METADATA, proto[name] ?? {}) !== undefined,
  );

  const pathOf = (name: string) =>
    (Reflect.getMetadata(PATH_METADATA, proto[name] ?? {}) as string) ?? '';

  /** The portal-preview routes proper: one client's view of their own portal. */
  const clientScoped = routes.filter((name) => pathOf(name).startsWith(':clientId'));

  it('never leaves the internal guard', () => {
    // The opposite of PortalController, and the reason preview is a separate surface.
    // @Public() here would expose every client's portal to anyone who can reach the API.
    expect(Reflect.getMetadata(IS_PUBLIC, PortalPreviewController)).toBeUndefined();
    const proto = PortalPreviewController.prototype as unknown as Record<string, object>;
    for (const route of routes) {
      const handler = proto[route];
      if (!handler) continue;
      expect(Reflect.getMetadata(IS_PUBLIC, handler), `${route} is public`).toBeUndefined();
    }
  });

  it('never previews a client’s portal with anything but a GET', () => {
    // Clients can accept quotes (step 4). Previewing must never be able to accept on
    // their behalf, and that is a property of this list rather than of anyone's care.
    for (const route of clientScoped) {
      const method = Reflect.getMetadata(METHOD_METADATA, proto[route] ?? {}) as RequestMethod;
      expect(RequestMethod[method], `${route} is not a GET`).toBe('GET');
    }
    expect(clientScoped.length).toBeGreaterThan(0);
  });

  it('scopes every preview route to one client id', () => {
    // No preview route may return data without naming a client. A "list everything"
    // endpoint here would be the cross-client read this module exists to prevent.
    const previewRoutes = routes.filter((name) => !name.endsWith('Request') && name !== 'openRequests');
    for (const route of previewRoutes) {
      expect(pathOf(route), `${route} is not client-scoped`).toMatch(/^:clientId(\/|$)/);
    }
    expect(previewRoutes).toEqual(clientScoped);
  });

  it('keeps request triage separate from previewing, and admin-only', () => {
    // Triage is about our inbox rather than one client's portal, so it is not
    // client-scoped — and every one of its routes still checks portal.admin.
    const triage = routes.filter((name) => !clientScoped.includes(name));
    expect(triage.sort()).toEqual(['convertRequest', 'declineRequest', 'openRequests']);
  });
});

describe('PortalPreviewController behaviour', () => {
  let controller: PortalPreviewController;
  let crm: CrmService;
  let clientId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE crm.projects, crm.clients CASCADE`);
    await seedUser(admin.userId, 'admin');
    await seedUser(member.userId, 'member');

    const manifests = new ManifestRegistry();
    manifests.register(crmManifest);
    manifests.register(portalManifest);
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    crm = new CrmService(
      testDb, registry, permissions, audit,
      new EventBus(manifests), new LinkService(testDb, registry, permissions, audit, manifests),
    );
    controller = new PortalPreviewController(
      new PortalProjection(testDb, manifests),
      permissions,
      new StorageService(),
      audit,
      // Request triage is exercised by its own spec; these tests are about previewing.
      {} as unknown as PortalRequestsService,
      testDb,
    );
    await crm.ensureReportingViews();

    clientId = (await crm.createClient(admin, { name: 'A client', status: 'active' })).id;
  });

  it('refuses a member, who holds every other capability', async () => {
    // portal.admin is adminOnly precisely so this is true. Reading a client's portal and
    // handing someone a login to it are the same kind of act.
    await expect(controller.projects(member, clientId)).rejects.toThrow(/portal.admin/);
  });

  it('records who previewed which client', async () => {
    await controller.projects(admin, clientId);

    const { rows } = await testDb.execute(sql`
      SELECT actor_id, action, entity_id FROM core.audit_log WHERE action = 'portal.previewed'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: admin.userId, entity_id: clientId });
  });

  it('records a preview even when the client has nothing to show', async () => {
    // An empty portal is still a portal that was looked at.
    expect(await controller.projects(admin, clientId)).toHaveLength(0);
    const { rows } = await testDb.execute(
      sql`SELECT 1 FROM core.audit_log WHERE action = 'portal.previewed'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('does not audit a refused preview as though it happened', async () => {
    await expect(controller.projects(member, clientId)).rejects.toThrow();
    const { rows } = await testDb.execute(
      sql`SELECT 1 FROM core.audit_log WHERE action = 'portal.previewed'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('distinguishes an unknown client from an empty one', async () => {
    // Returning [] for a client id that matches nothing would read as "they have no
    // projects", which is a different and misleading answer.
    await expect(controller.projects(admin, crypto.randomUUID())).rejects.toThrow(/No such client/);
  });

  it('shows exactly what the client would see, through the same queries', async () => {
    await crm.createProject(admin, {
      clientId, name: 'Theirs', billingModel: 'time_and_materials',
    });

    const previewed = await controller.projects(admin, clientId);
    const asClient = await new PortalProjection(testDb, manifestsWith()).projects({ clientId });
    // Same projection, so a preview cannot drift from reality — which matters more than
    // it sounds, because a preview that is wrong is worse than none: it gets believed.
    expect(previewed).toEqual(asClient);
  });

  function manifestsWith(): ManifestRegistry {
    const m = new ManifestRegistry();
    m.register(crmManifest);
    m.register(portalManifest);
    m.seal();
    return m;
  }
});
