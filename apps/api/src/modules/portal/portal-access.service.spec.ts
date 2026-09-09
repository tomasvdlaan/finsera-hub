import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { ZitadelTokens } from '../../core/auth/zitadel.tokens.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { UserService } from '../../core/auth/user.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { PortalAccessService } from './portal-access.service.js';
import { PortalPagesService } from './portal-pages.service.js';
import { PortalUsersService } from './portal-users.service.js';
import { portalManifest } from './portal.manifest.js';
import type { PortalStaff, PortalVisitor } from './portal.projection.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const member: Actor = { userId: crypto.randomUUID(), role: 'member' };

/**
 * Who, inside one client, may open which report.
 *
 * The cross-client boundary is not tested here — `portal-isolation.spec.ts` owns that, and it
 * is a different rule with a different mechanism. What these tests are about is the rule this
 * service adds on top of it, and the thing worth holding on to is that the two never trade:
 * every case below runs inside one client, and none of them can widen anything.
 */
describe('PortalAccessService', () => {
  let access: PortalAccessService;
  let pages: PortalPagesService;
  let users: PortalUsersService;
  let crm: CrmService;
  let clientId: string;
  let otherClientId: string;

  const visitor = (portalUserId: string, client = clientId): PortalVisitor => ({
    portalUserId,
    clientId: client,
    email: 'them@duce.nl',
    seesInvoices: true,
    seesQuotes: true,
  });
  const staff: PortalStaff = {
    staffUserId: admin.userId,
    clientId: '',
    email: 'tomas@finsera.nl',
  };

  beforeEach(async () => {
    await resetDb();
    await truncate(
      sql`TRUNCATE portal.artefact_grants, portal.artefact_visibility, portal.users,
                  portal.pages, crm.projects, crm.clients CASCADE`,
    );
    await seedUser(admin.userId, 'admin');
    await seedUser(member.userId, 'member');
    process.env.PORTAL_PAGE_KEY = Buffer.alloc(32, 7).toString('base64');

    const manifests = new ManifestRegistry();
    manifests.register(crmManifest);
    manifests.register(portalManifest);
    manifests.seal();
    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService(testDb);
    access = new PortalAccessService(testDb, permissions, audit);
    crm = new CrmService(
      testDb,
      registry,
      permissions,
      audit,
      new EventBus(manifests),
      new LinkService(testDb, registry, permissions, audit, manifests),
    );
    pages = new PortalPagesService(testDb, permissions, audit, new StorageService(), access);
    users = new PortalUsersService(
      testDb,
      permissions,
      audit,
      new UserService(testDb, audit, new ZitadelTokens()),
      registry,
    );

    clientId = (await crm.createClient(admin, { name: 'Duce', status: 'active', portalSlug: 'duce' }))
      .id;
    otherClientId = (
      await crm.createClient(admin, { name: 'DocHorse', status: 'active', portalSlug: 'dochorse' })
    ).id;
    staff.clientId = clientId;
  });

  const aPage = async (slug = 'marge') =>
    (
      await pages.create(admin, clientId, {
        slug,
        title: 'Marge-analyse',
        sourceUrl: `https://${slug}-duce.vercel.app`,
      })
    ).id;

  const aLogin = async (email: string, client = clientId) =>
    (await users.invite(admin, { clientId: client, email })).id;

  it('shows an unrestricted report to everyone at the client, as it always has', async () => {
    const id = await aPage();
    const bob = await aLogin('bob@duce.nl');

    // No visibility row at all — the state every page created before this feature is in.
    expect(await access.hiddenIds('page', visitor(bob))).toEqual([]);
    expect(await access.maySee('page', id, visitor(bob))).toBe(true);
    expect(await pages.forClient(visitor(bob))).toHaveLength(1);
  });

  it('restricts a report to the people named on it, and hides it from the rest', async () => {
    const id = await aPage();
    const bob = await aLogin('bob@duce.nl');
    const carla = await aLogin('carla@duce.nl');

    await access.set(admin, 'page', id, { mode: 'restricted', userIds: [bob] });

    expect(await access.maySee('page', id, visitor(bob))).toBe(true);
    expect(await access.maySee('page', id, visitor(carla))).toBe(false);
    expect(await access.hiddenIds('page', visitor(carla))).toEqual([id]);

    // And the list a browser is given, which is what a client actually sees.
    expect(await pages.forClient(visitor(bob))).toHaveLength(1);
    expect(await pages.forClient(visitor(carla))).toEqual([]);
  });

  it('lets one of us see it anyway, because that view exists to check what was shared', async () => {
    const id = await aPage();
    const bob = await aLogin('bob@duce.nl');
    await access.set(admin, 'page', id, { mode: 'restricted', userIds: [bob] });

    expect(await access.maySee('page', id, staff)).toBe(true);
    expect(await access.hiddenIds('page', staff)).toEqual([]);
  });

  it('gives it back to everyone when the restriction is lifted', async () => {
    const id = await aPage();
    const bob = await aLogin('bob@duce.nl');
    const carla = await aLogin('carla@duce.nl');
    await access.set(admin, 'page', id, { mode: 'restricted', userIds: [bob] });
    expect(await access.maySee('page', id, visitor(carla))).toBe(false);

    await access.set(admin, 'page', id, { mode: 'everyone', userIds: [bob] });
    expect(await access.maySee('page', id, visitor(carla))).toBe(true);
    // The list somebody built is kept, so turning the restriction back on restores it
    // rather than starting from an empty page.
    expect((await access.get(admin, 'page', id)).userIds).toEqual([bob]);
  });

  it('refuses to restrict something to nobody', async () => {
    const id = await aPage();
    // The slip this guards against: clearing the ticks and saving. It would hide the report
    // from everyone with nothing on screen saying who was meant to have it.
    await expect(
      access.set(admin, 'page', id, { mode: 'restricted', userIds: [] }),
    ).rejects.toThrow(/at least one person/i);
  });

  it('cannot name somebody at another client', async () => {
    const id = await aPage();
    const outsider = await aLogin('them@dochorse.nl', otherClientId);
    await expect(
      access.set(admin, 'page', id, { mode: 'restricted', userIds: [outsider] }),
    ).rejects.toThrow(/belong to this client/i);
  });

  it('is admin-only, like every other way of deciding who sees a client’s data', async () => {
    const id = await aPage();
    await expect(access.get(member, 'page', id)).rejects.toThrow(/portal.admin/);
    await expect(
      access.set(member, 'page', id, { mode: 'everyone', userIds: [] }),
    ).rejects.toThrow(/portal.admin/);
  });

  it('forgets who could see a report when the report is deleted', async () => {
    const id = await aPage();
    const bob = await aLogin('bob@duce.nl');
    await access.set(admin, 'page', id, { mode: 'restricted', userIds: [bob] });

    await pages.remove(admin, id);

    // A `restricted` row for a dead id would come back to life if that id were ever reused.
    const { rows } = await testDb.execute(
      sql`SELECT 1 FROM portal.artefact_visibility WHERE artefact_id = ${id}::uuid
          UNION ALL SELECT 1 FROM portal.artefact_grants WHERE artefact_id = ${id}::uuid`,
    );
    expect(rows).toEqual([]);
  });

  it('lists a client’s reports and documents with who may open each', async () => {
    const open = await aPage('open');
    const closed = await aPage('marge');
    const bob = await aLogin('bob@duce.nl');
    await access.set(admin, 'page', closed, { mode: 'restricted', userIds: [bob] });

    const all = await access.artefactsFor(admin, clientId);

    // Everything divisible, not only what is restricted: the person's page asks "what can they
    // open", and an artefact shared with everyone is an answer to that question too.
    expect(all).toHaveLength(2);
    expect(all.find((a) => a.id === open)).toMatchObject({
      kind: 'page',
      mode: 'everyone',
      userIds: [],
    });
    expect(all.find((a) => a.id === closed)).toMatchObject({
      kind: 'page',
      title: 'Marge-analyse',
      mode: 'restricted',
      userIds: [bob],
    });
  });

  it('does not leak another client’s artefacts into this one’s list', async () => {
    await aPage('ours');
    const theirs = await pages.create(admin, otherClientId, {
      slug: 'theirs',
      title: 'DocHorse rapport',
      sourceUrl: 'https://theirs-dochorse.vercel.app',
    });

    const all = await access.artefactsFor(admin, clientId);
    expect(all.map((a) => a.id)).not.toContain(theirs.id);
  });

  it('is admin-only to list, like everything else that names a client’s data', async () => {
    await expect(access.artefactsFor(member, clientId)).rejects.toThrow(/portal.admin/);
  });
});
