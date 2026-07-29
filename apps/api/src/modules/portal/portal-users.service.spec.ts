import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { PortalUsersService } from './portal-users.service.js';
import { portalManifest } from './portal.manifest.js';
import { portalUsers } from './portal.schema.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const member: Actor = { userId: crypto.randomUUID(), role: 'member' };

describe('PortalUsersService', () => {
  let service: PortalUsersService;
  let crm: CrmService;
  let clientId: string;

  beforeEach(async () => {
    await resetDb();
    await testDb.execute(sql`TRUNCATE portal.users, crm.projects, crm.clients CASCADE`);
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
    service = new PortalUsersService(testDb, permissions, audit);

    clientId = (await crm.createClient(admin, { name: 'A client', status: 'active' })).id;
  });

  // ── the rule that separates this from internal auth ──

  it('refuses a subject nobody invited, rather than provisioning one', async () => {
    // Internal users are created just-in-time on first sign-in. Doing that here would mean
    // anyone able to obtain a portal-project token becomes a portal user, and the only
    // remaining question is whose data they get mapped to.
    await expect(service.resolveFromSubject('sub-nobody-invited')).rejects.toThrow(
      /No portal access/,
    );
    const [row] = await testDb.select().from(portalUsers);
    expect(row, 'a refused sign-in must not leave a user behind').toBeUndefined();
  });

  it('resolves an invited subject to their client', async () => {
    await service.invite(admin, {
      clientId, email: 'finance@aclient.nl', oidcSubject: 'sub-invited',
    });

    const visitor = await service.resolveFromSubject('sub-invited');
    expect(visitor.clientId).toBe(clientId);
    expect(visitor.email).toBe('finance@aclient.nl');
  });

  it('refuses a revoked login while keeping the row', async () => {
    const { id } = await service.invite(admin, {
      clientId, email: 'left@aclient.nl', oidcSubject: 'sub-left',
    });
    await service.revoke(admin, id);

    await expect(service.resolveFromSubject('sub-left')).rejects.toThrow(/No portal access/);
    // The row survives, because "who had access to this client's invoices last year" is
    // asked after somebody leaves, not before.
    const [row] = await testDb.select().from(portalUsers).where(eq(portalUsers.id, id));
    expect(row?.disabledAt).toBeInstanceOf(Date);
  });

  it('does not revoke the same login twice', async () => {
    const { id } = await service.invite(admin, {
      clientId, email: 'a@aclient.nl', oidcSubject: 'sub-a',
    });
    await service.revoke(admin, id);
    await expect(service.revoke(admin, id)).rejects.toThrow(/No such active portal user/);
  });

  // ── one login is one client ──

  it('will not map one subject to two clients', async () => {
    const other = (await crm.createClient(admin, { name: 'Other', status: 'active' })).id;
    await service.invite(admin, { clientId, email: 'both@x.nl', oidcSubject: 'sub-both' });

    // A person working for two clients gets two logins. Merging them would mean a session
    // that spans clients, which is the one thing this whole phase is built to prevent.
    await expect(
      service.invite(admin, { clientId: other, email: 'both@x.nl', oidcSubject: 'sub-both' }),
    ).rejects.toThrow();
  });

  it('allows the same person a separate login per client', async () => {
    const other = (await crm.createClient(admin, { name: 'Other', status: 'active' })).id;
    await service.invite(admin, { clientId, email: 'both@x.nl', oidcSubject: 'sub-one' });
    await service.invite(admin, { clientId: other, email: 'both@x.nl', oidcSubject: 'sub-two' });

    expect((await service.resolveFromSubject('sub-one')).clientId).toBe(clientId);
    expect((await service.resolveFromSubject('sub-two')).clientId).toBe(other);
  });

  // ── granting access is an internal privilege ──

  it('refuses to invite without portal.admin', async () => {
    // Members hold every other declared capability under the v0 model, so this only holds
    // because `portal.admin` is marked adminOnly. If that flag is ever dropped, granting
    // an outsider access to a client's invoices quietly becomes a member-level action.
    await expect(
      service.invite(member, { clientId, email: 'x@y.nl', oidcSubject: 'sub-x' }),
    ).rejects.toThrow(/Missing capability/);
  });

  it('refuses to revoke without portal.admin', async () => {
    const { id } = await service.invite(admin, {
      clientId, email: 'x@y.nl', oidcSubject: 'sub-x',
    });
    await expect(service.revoke(member, id)).rejects.toThrow(/Missing capability/);
  });

  it('records who granted and who revoked access', async () => {
    const { id } = await service.invite(admin, {
      clientId, email: 'audited@aclient.nl', oidcSubject: 'sub-audited',
    });
    await service.revoke(admin, id);

    const { rows } = await testDb.execute(sql`
      SELECT action FROM core.audit_log
       WHERE entity_id = ${id} ORDER BY created_at
    `);
    expect(rows.map((r) => (r as { action: string }).action)).toEqual([
      'portal.invited',
      'portal.revoked',
    ]);
  });
});
