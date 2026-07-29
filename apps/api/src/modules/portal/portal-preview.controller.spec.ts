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
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { PortalPreviewController } from './portal-preview.controller.js';
import { portalManifest } from './portal.manifest.js';
import { PortalProjection } from './portal.projection.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const member: Actor = { userId: crypto.randomUUID(), role: 'member' };

describe('PortalPreviewController wiring', () => {
  const routes = Object.getOwnPropertyNames(PortalPreviewController.prototype).filter(
    (name) => name !== 'constructor' && name !== 'allow',
  );

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

  it('is read-only, and stays that way', () => {
    // Step 4 gives clients quote acceptance. Previewing must never be able to accept on
    // a client's behalf, and that is a property of this list rather than of anyone's care.
    const proto = PortalPreviewController.prototype as unknown as Record<string, object>;
    for (const route of routes) {
      const handler = proto[route];
      if (!handler) continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
      expect(RequestMethod[method], `${route} is not a GET`).toBe('GET');
    }
    expect(routes.length).toBeGreaterThan(0);
  });

  it('scopes every route to one client id', () => {
    // No route may return data without naming a client. A "list everything" endpoint here
    // would be the cross-client read this module exists to make impossible.
    const proto = PortalPreviewController.prototype as unknown as Record<string, object>;
    for (const route of routes) {
      const handler = proto[route];
      if (!handler) continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      expect(path, `${route} is not client-scoped`).toMatch(/^:clientId(\/|$)/);
    }
  });
});

describe('PortalPreviewController behaviour', () => {
  let controller: PortalPreviewController;
  let crm: CrmService;
  let clientId: string;

  beforeEach(async () => {
    await resetDb();
    await testDb.execute(sql`TRUNCATE crm.projects, crm.clients CASCADE`);
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
      new EventBus(manifests), new LinkService(testDb, registry, permissions, audit),
    );
    controller = new PortalPreviewController(
      new PortalProjection(testDb, manifests), permissions, new StorageService(), audit, testDb,
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
