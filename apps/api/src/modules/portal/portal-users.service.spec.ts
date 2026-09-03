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
import { PortalUsersService } from './portal-users.service.js';
import { portalManifest } from './portal.manifest.js';
import { PortalSessionsService } from './portal-sessions.service.js';
import { portalSessions, portalUsers } from './portal.schema.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const member: Actor = { userId: crypto.randomUUID(), role: 'member' };

describe('PortalUsersService', () => {
  let service: PortalUsersService;
  let crm: CrmService;
  let clientId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE portal.sessions, portal.users, crm.projects, crm.clients CASCADE`);
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
    service = new PortalUsersService(testDb, permissions, audit);

    clientId = (await crm.createClient(admin, { name: 'A client', status: 'active' })).id;
    // Phase 8: a login needs somewhere to go, so a client without a portal address cannot
    // have one invited. Every test below invites, so every test gets an address.
    await crm.updateClient(admin, clientId, { portalSlug: 'aclient' });
  });

  it('refuses to invite anyone to a client without a portal address', async () => {
    const homeless = (await crm.createClient(admin, { name: 'No portal yet', status: 'active' })).id;

    // A successful sign-in that lands nowhere is a support ticket, not a feature.
    await expect(
      service.invite(admin, { clientId: homeless, email: 'someone@noportal.nl' }),
    ).rejects.toThrow(/portal address/i);
  });

  it('ends every session of a login it revokes, in the same commit', async () => {
    const { id } = await service.invite(admin, {
      clientId, email: 'leaving@aclient.nl', oidcSubject: 'sub-leaving',
    });
    const sessions = new PortalSessionsService(testDb);
    const { secret } = await sessions.create({ kind: 'client', portalUserId: id, clientId });
    expect(await sessions.resolve(secret)).not.toBeNull();

    await service.revoke(admin, id);

    // Refused twice over: the session row is revoked, and the user row it points at is
    // disabled. Either alone would do; the test is that neither was forgotten.
    expect(await sessions.resolve(secret)).toBeNull();
    const [row] = await testDb.select().from(portalSessions).where(eq(portalSessions.portalUserId, id));
    expect(row?.revokedAt).not.toBeNull();
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
    await crm.updateClient(admin, other, { portalSlug: 'other' });
    await service.invite(admin, { clientId, email: 'both@x.nl', oidcSubject: 'sub-both' });

    // A person working for two clients gets two logins. Merging them would mean a session
    // that spans clients, which is the one thing this whole phase is built to prevent.
    await expect(
      service.invite(admin, { clientId: other, email: 'both@x.nl', oidcSubject: 'sub-both' }),
    ).rejects.toThrow();
  });

  it('allows the same person a separate login per client', async () => {
    const other = (await crm.createClient(admin, { name: 'Other', status: 'active' })).id;
    await crm.updateClient(admin, other, { portalSlug: 'other' });
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

  // ── invitations that bind on first sign-in ──

  it('binds an invitation to the subject that first signs in with that email', async () => {
    await service.invite(admin, { clientId, email: 'finance@aclient.nl' });

    // Nothing to resolve until somebody actually arrives.
    await expect(service.resolveFromSubject('sub-new')).rejects.toThrow(/No portal access/);

    const claimed = await service.claimInvitation('sub-new', 'finance@aclient.nl');
    expect(claimed?.clientId).toBe(clientId);
    // And from then on the subject is what identifies them; the email was the introduction.
    expect((await service.resolveFromSubject('sub-new')).clientId).toBe(clientId);
  });

  it('matches an email regardless of how it was typed', async () => {
    await service.invite(admin, { clientId, email: 'Finance@AClient.nl' });
    expect(await service.claimInvitation('sub-case', 'finance@aclient.nl')).not.toBeNull();
  });

  it('lets an invitation be claimed exactly once', async () => {
    await service.invite(admin, { clientId, email: 'finance@aclient.nl' });
    await service.claimInvitation('sub-first', 'finance@aclient.nl');

    // A second person signing in with the same address finds nothing left to claim —
    // otherwise one invitation would be a key that copies itself.
    expect(await service.claimInvitation('sub-second', 'finance@aclient.nl')).toBeNull();
  });

  it('claims nothing when no invitation names that address', async () => {
    // The whole point: this is not just-in-time provisioning wearing a hat. No invitation,
    // no account, however genuine the email.
    expect(await service.claimInvitation('sub-stranger', 'anyone@example.com')).toBeNull();
    expect(await testDb.select().from(portalUsers)).toHaveLength(0);
  });

  it('will not claim a revoked invitation', async () => {
    const { id } = await service.invite(admin, { clientId, email: 'left@aclient.nl' });
    await service.revoke(admin, id);

    // Revoking before first sign-in must not leave a claimable row behind.
    expect(await service.claimInvitation('sub-left', 'left@aclient.nl')).toBeNull();
  });

  it('refuses to invite the same address to one client twice', async () => {
    await service.invite(admin, { clientId, email: 'finance@aclient.nl' });
    await expect(
      service.invite(admin, { clientId, email: 'FINANCE@aclient.nl' }),
    ).rejects.toThrow(/already has access/);
  });

  it('still allows the same address at a different client', async () => {
    const other = (await crm.createClient(admin, { name: 'Other', status: 'active' })).id;
    await crm.updateClient(admin, other, { portalSlug: 'other' });
    await service.invite(admin, { clientId, email: 'consultant@bureau.nl' });
    await expect(
      service.invite(admin, { clientId: other, email: 'consultant@bureau.nl' }),
    ).resolves.toBeTruthy();
  });

  it('gives one Zitadel account access to one client, not both', async () => {
    const other = (await crm.createClient(admin, { name: 'Other', status: 'active' })).id;
    await crm.updateClient(admin, other, { portalSlug: 'other' });
    await service.invite(admin, { clientId, email: 'consultant@bureau.nl' });
    await service.invite(admin, { clientId: other, email: 'consultant@bureau.nl' });

    const first = await service.claimInvitation('sub-consultant', 'consultant@bureau.nl');
    expect(first).not.toBeNull();

    // The same account cannot also claim the second invitation. A person working for two
    // clients needs two accounts, because one session must never span clients — and the
    // refusal is clean rather than a unique-constraint violation reaching the client.
    expect(await service.claimInvitation('sub-consultant', 'consultant@bureau.nl')).toBeNull();
    expect((await service.resolveFromSubject('sub-consultant')).clientId).toBe(first!.clientId);
  });

  it('reports whether an invitation is still waiting', async () => {
    await service.invite(admin, { clientId, email: 'pending@aclient.nl' });
    const [before] = await service.listForClient(admin, clientId);
    expect(before?.pending).toBe(true);

    await service.claimInvitation('sub-arrived', 'pending@aclient.nl');
    const [after] = await service.listForClient(admin, clientId);
    // "Invited" and "has actually been in" are different answers to "why can't they see
    // anything", and the list has to be able to tell them apart.
    expect(after?.pending).toBe(false);
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
