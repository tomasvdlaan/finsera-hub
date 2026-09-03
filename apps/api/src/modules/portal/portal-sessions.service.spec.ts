import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { users as coreUsers } from '../../core/db/core.schema.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { PortalHostService } from './portal-host.service.js';
import { PortalSessionsService, SESSION_IDLE_MS } from './portal-sessions.service.js';
import { PortalUsersService } from './portal-users.service.js';
import { portalManifest } from './portal.manifest.js';
import { portalHandoffTickets, portalSessions } from './portal.schema.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/**
 * The two secrets a portal browser is ever handed, and every way each one stops working.
 *
 * Against a real database on purpose: single-use is a property of `DELETE … RETURNING`,
 * and revocation-on-disable is a join. Neither is something a mock can be wrong about in
 * an interesting way.
 */
describe('PortalSessionsService', () => {
  let sessions: PortalSessionsService;
  let users: PortalUsersService;
  let crm: CrmService;
  let clientId: string;
  let portalUserId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(
      sql`TRUNCATE portal.sessions, portal.handoff_tickets, portal.users, crm.projects, crm.clients CASCADE`,
    );
    await seedUser(admin.userId, 'admin');

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
    users = new PortalUsersService(testDb, permissions, audit);
    sessions = new PortalSessionsService(testDb);

    clientId = (await crm.createClient(admin, { name: 'Duce', status: 'active' })).id;
    await crm.updateClient(admin, clientId, { portalSlug: 'duce' });
    portalUserId = (
      await users.invite(admin, { clientId, email: 'finance@duce.nl', oidcSubject: 'sub-duce' })
    ).id;
  });

  const owner = () => ({ kind: 'client' as const, portalUserId, clientId });

  it('stores a hash, never the secret', async () => {
    const { secret } = await sessions.create(owner());
    const [row] = await testDb.select().from(portalSessions);
    expect(row?.secretHash).not.toContain(secret);
    expect(row?.secretHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('resolves a live session to its owner and email', async () => {
    const { secret } = await sessions.create(owner());
    expect(await sessions.resolve(secret)).toMatchObject({
      kind: 'client', portalUserId, clientId, email: 'finance@duce.nl',
    });
  });

  it('resolves nothing for a secret it never issued', async () => {
    await sessions.create(owner());
    expect(await sessions.resolve('not-a-secret')).toBeNull();
    expect(await sessions.resolve('')).toBeNull();
  });

  it('ends a revoked session', async () => {
    const { id, secret } = await sessions.create(owner());
    await sessions.revoke(id);
    expect(await sessions.resolve(secret)).toBeNull();
  });

  it('ends a session that has sat idle too long', async () => {
    const { id, secret } = await sessions.create(owner());
    await testDb
      .update(portalSessions)
      .set({ lastSeenAt: new Date(Date.now() - SESSION_IDLE_MS - 1000) })
      .where(eq(portalSessions.id, id));
    expect(await sessions.resolve(secret)).toBeNull();
  });

  it('ends a session past its absolute expiry however recently it was used', async () => {
    const { id, secret } = await sessions.create(owner());
    await testDb
      .update(portalSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(portalSessions.id, id));
    expect(await sessions.resolve(secret)).toBeNull();
  });

  it('ends every session of a login the moment it is disabled', async () => {
    // The check that matters most: not "was the session row touched" but "does the login
    // still work". Revoking the user must be enough on its own.
    const { secret } = await sessions.create(owner());
    await users.revoke(admin, portalUserId);
    expect(await sessions.resolve(secret)).toBeNull();
  });

  it('refuses to create a session that has no owner, or two', async () => {
    await expect(
      sessions.create({ kind: 'client', clientId } as never),
    ).rejects.toThrow();
    await expect(
      sessions.create({ kind: 'client', portalUserId, staffUserId: admin.userId, clientId }),
    ).rejects.toThrow();
  });

  // ── staff sessions (P5) ──

  it('resolves a staff session with the employee’s own identity', async () => {
    const { secret } = await sessions.create({
      kind: 'staff', staffUserId: admin.userId, clientId,
    });
    expect(await sessions.resolve(secret)).toMatchObject({
      kind: 'staff', staffUserId: admin.userId, clientId, portalUserId: null,
    });
    // The email comes from core.users, not from the session row — so it is whatever the
    // identity provider last said, and a session cannot carry a stale name for a person.
    expect((await sessions.resolve(secret))?.email).toBe(`${admin.userId}@test.local`);
  });

  it('ends a staff session when the colleague is deactivated', async () => {
    const { secret } = await sessions.create({
      kind: 'staff', staffUserId: admin.userId, clientId,
    });
    await testDb.update(coreUsers).set({ isActive: false }).where(eq(coreUsers.id, admin.userId));

    // The internal deactivate flag has to close every door, not the internal one only.
    expect(await sessions.resolve(secret)).toBeNull();
  });

  // ── handoff tickets ──

  it('redeems a ticket exactly once, on the host it names', async () => {
    const ticket = await sessions.issueTicket(owner(), 'duce.finsera.nl', '/rapporten');

    expect(await sessions.redeemTicket(ticket, 'duce.finsera.nl')).toMatchObject({
      owner: { kind: 'client', portalUserId, clientId },
      next: '/rapporten',
    });
    // Gone. A ticket URL that leaked into a log or a referrer is now worth nothing.
    expect(await sessions.redeemTicket(ticket, 'duce.finsera.nl')).toBeNull();
    expect(await testDb.select().from(portalHandoffTickets)).toHaveLength(0);
  });

  it('refuses a ticket presented at another host, and burns it', async () => {
    const ticket = await sessions.issueTicket(owner(), 'duce.finsera.nl', '/');

    // The attack: a ticket issued for duce, redeemed at dochorse, would put a duce session
    // on a dochorse cookie. Refused — and consumed, so it cannot then be tried at duce.
    expect(await sessions.redeemTicket(ticket, 'dochorse.finsera.nl')).toBeNull();
    expect(await sessions.redeemTicket(ticket, 'duce.finsera.nl')).toBeNull();
  });

  /*
   * The two sides carry different representations, and the test has to as well.
   *
   * An earlier version of this test passed the same string to both calls, so it passed
   * while the real flow — cookie holds the nonce, ticket holds its hash — failed every
   * time with "login expired". Deriving the hash here the way the controller does is what
   * makes the test able to see that.
   */
  const nonceHash = (nonce: string) => createHash('sha256').update(nonce).digest('hex');

  it('refuses a bound ticket redeemed by a different browser', async () => {
    const ticket = await sessions.issueTicket(owner(), 'duce.finsera.nl', '/', nonceHash('my-nonce'));

    // The attack: somebody with their own login here starts one, captures their ticket URL
    // and gets a colleague to open it inside the minute. Without the binding the colleague's
    // browser would be carrying the attacker's session, and everything they typed after
    // that would land in the attacker's account.
    expect(await sessions.redeemTicket(ticket, 'duce.finsera.nl', 'someone-elses')).toBeNull();
    expect(await sessions.redeemTicket(ticket, 'duce.finsera.nl', undefined)).toBeNull();
  });

  it('redeems a bound ticket for the browser that started the login', async () => {
    const ticket = await sessions.issueTicket(
      owner(), 'duce.finsera.nl', '/rapporten', nonceHash('my-nonce'),
    );
    expect(await sessions.redeemTicket(ticket, 'duce.finsera.nl', 'my-nonce')).toMatchObject({
      next: '/rapporten',
    });
  });

  it('still redeems an unbound ticket, for a login that began on the login host', async () => {
    const ticket = await sessions.issueTicket(owner(), 'duce.finsera.nl', '/', null);
    expect(await sessions.redeemTicket(ticket, 'duce.finsera.nl', undefined)).toBeTruthy();
  });

  it('refuses an expired ticket', async () => {
    const ticket = await sessions.issueTicket(owner(), 'duce.finsera.nl', '/');
    await testDb.update(portalHandoffTickets).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await sessions.redeemTicket(ticket, 'duce.finsera.nl')).toBeNull();
  });
});

describe('PortalHostService', () => {
  let hosts: PortalHostService;
  let crm: CrmService;
  let clientId: string;
  const env = { ...process.env };

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE crm.projects, crm.clients CASCADE`);
    await seedUser(admin.userId, 'admin');
    process.env.PORTAL_BASE_DOMAIN = 'finsera.nl';
    process.env.PORTAL_AUTH_HOST = 'portal.finsera.nl';

    const manifests = new ManifestRegistry();
    manifests.register(crmManifest);
    manifests.seal();
    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    crm = new CrmService(
      testDb, registry, permissions, audit,
      new EventBus(manifests), new LinkService(testDb, registry, permissions, audit, manifests),
    );
    hosts = new PortalHostService(testDb);
    clientId = (await crm.createClient(admin, { name: 'Duce', status: 'active' })).id;
    await crm.updateClient(admin, clientId, { portalSlug: 'duce' });
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('resolves a client host to its client, whatever the header looks like', async () => {
    for (const header of ['duce.finsera.nl', 'DUCE.finsera.nl', 'duce.finsera.nl.', ' duce.finsera.nl ']) {
      expect(await hosts.resolve(header), header).toMatchObject({ kind: 'client', clientId, slug: 'duce' });
    }
  });

  it('resolves the auth host, and nothing else on the base domain', async () => {
    expect(await hosts.resolve('portal.finsera.nl')).toEqual({ kind: 'auth', host: 'portal.finsera.nl' });
    // The internal app, an unknown slug, a nested label, the bare domain, another domain.
    for (const header of ['hub.finsera.nl', 'nobody.finsera.nl', 'a.duce.finsera.nl', 'finsera.nl', 'duce.example.com', undefined]) {
      expect(await hosts.resolve(header), String(header)).toBeNull();
    }
  });

  it('stops resolving a client the moment their slug is cleared', async () => {
    await crm.updateClient(admin, clientId, { portalSlug: null });
    expect(await hosts.resolve('duce.finsera.nl')).toBeNull();
  });

  it('follows a slug when it moves to another client, immediately', async () => {
    const other = (await crm.createClient(admin, { name: 'DocHorse', status: 'active' })).id;
    await crm.updateClient(admin, clientId, { portalSlug: null });
    await crm.updateClient(admin, other, { portalSlug: 'duce' });
    // The failure this replaces: a stale answer here would have let the previous owner's
    // session keep working at an address that is now somebody else's.
    expect(await hosts.resolve('duce.finsera.nl')).toMatchObject({ clientId: other });
  });

  it('stops resolving an archived client', async () => {
    await crm.archiveClient(admin, clientId);
    // No cache to clear: archiving takes the portal away immediately, which is the whole
    // reason the lookup is not cached.
    expect(await hosts.resolve('duce.finsera.nl')).toBeNull();
  });

  it('refuses a slug that is reserved or malformed, at the CRM', async () => {
    for (const slug of ['hub', 'www', 'portal', 'Du ce', 'a', '-duce', 'duce-', 'x'.repeat(41)]) {
      await expect(crm.updateClient(admin, clientId, { portalSlug: slug }), slug).rejects.toThrow(/Portal address/);
    }
    // Case is corrected, not refused: `Duce` is what somebody types.
    expect((await crm.updateClient(admin, clientId, { portalSlug: 'Duce' })).portalSlug).toBe('duce');
  });

  it('refuses a slug another client already has, by name', async () => {
    const other = (await crm.createClient(admin, { name: 'DocHorse', status: 'active' })).id;
    await expect(crm.updateClient(admin, other, { portalSlug: 'duce' })).rejects.toThrow(/already used by Duce/);
  });
});
