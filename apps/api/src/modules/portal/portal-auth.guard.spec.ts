import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { PortalAuthGuard } from './portal-auth.guard.js';
import type { PortalHost, PortalHostService } from './portal-host.service.js';
import type { PortalSessionsService, ResolvedSession } from './portal-sessions.service.js';

const DUCE: PortalHost = {
  kind: 'client', host: 'duce.finsera.nl', slug: 'duce', clientId: 'c-duce', clientName: 'Duce',
};
const DOCHORSE: PortalHost = {
  kind: 'client', host: 'dochorse.finsera.nl', slug: 'dochorse', clientId: 'c-dh', clientName: 'DocHorse',
};

const clientSession: ResolvedSession = {
  id: 's-1', kind: 'client', portalUserId: 'pu-1', staffUserId: null,
  clientId: 'c-duce', email: 'finance@duce.nl',
};
const staffSession: ResolvedSession = {
  id: 's-2', kind: 'staff', portalUserId: null, staffUserId: 'u-1',
  clientId: 'c-duce', email: 'tomas@finsera.nl',
};

function build(host: PortalHost | null, session: ResolvedSession | null) {
  const sessions = { resolve: vi.fn().mockResolvedValue(session) } as unknown as PortalSessionsService;
  const hosts = { resolve: vi.fn().mockResolvedValue(host) } as unknown as PortalHostService;
  return new PortalAuthGuard(sessions, hosts);
}

function ctx(req: Record<string, unknown>): ExecutionContext {
  const request = { method: 'GET', headers: { host: 'duce.finsera.nl', cookie: 'psid=secret' }, ...req };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

/**
 * What the cookie is allowed to mean, and where it is not.
 *
 * The interesting cases are all refusals, and none of them are about the cookie being
 * valid — it is, in every test below. They are about a valid session being presented
 * somewhere it does not belong.
 */
describe('PortalAuthGuard', () => {
  it('resolves a client session on its own host', async () => {
    const guard = build(DUCE, clientSession);
    const c = ctx({});
    expect(await guard.canActivate(c)).toBe(true);
    expect(c.switchToHttp().getRequest<{ viewer: unknown }>().viewer).toEqual({
      portalUserId: 'pu-1', clientId: 'c-duce', email: 'finance@duce.nl',
    });
  });

  it('refuses a client session presented at another client’s host', async () => {
    // The attack the whole hostname design has to survive: a real, live session for Duce,
    // sent to DocHorse's portal. The cookie is scoped per host so it should not arrive at
    // all — this is the lock behind that one.
    const guard = build(DOCHORSE, clientSession);
    await expect(guard.canActivate(ctx({ headers: { host: 'dochorse.finsera.nl', cookie: 'psid=secret' } })))
      .rejects.toThrow(/Not your portal/);
  });

  it('never sets an internal actor', async () => {
    const guard = build(DUCE, clientSession);
    const c = ctx({});
    await guard.canActivate(c);
    // A portal request must not satisfy an internal guard, and an unset field is what makes
    // an accidentally-shared controller fail closed rather than serve the business.
    expect(c.switchToHttp().getRequest<{ actor?: unknown }>().actor).toBeUndefined();
  });

  it('refuses a request with no cookie, no session, or no host', async () => {
    await expect(build(DUCE, clientSession).canActivate(ctx({ headers: { host: 'duce.finsera.nl' } })))
      .rejects.toThrow(/No portal session/);
    await expect(build(DUCE, null).canActivate(ctx({}))).rejects.toThrow(/No portal session/);
    // `hub.finsera.nl` and anything unknown resolve to no host at all.
    await expect(build(null, clientSession).canActivate(ctx({}))).rejects.toThrow(/No portal session/);
  });

  it('requires the request header on a write, and not on a read', async () => {
    const guard = build(DUCE, clientSession);
    await expect(guard.canActivate(ctx({ method: 'POST' }))).rejects.toThrow(/Missing request header/);
    expect(
      await guard.canActivate(
        ctx({ method: 'POST', headers: { host: 'duce.finsera.nl', cookie: 'psid=secret', 'x-requested-with': 'portal' } }),
      ),
    ).toBe(true);
  });

  // ── staff (P5) ──

  it('lets an employee in, as staff rather than as the client', async () => {
    const guard = build(DUCE, staffSession);
    const c = ctx({});
    expect(await guard.canActivate(c)).toBe(true);
    const { viewer } = c.switchToHttp().getRequest<{ viewer: Record<string, unknown> }>();
    // A staff id and no portal user id, which is what the write routes key off: they ask
    // for a visitor, and this cannot be one.
    expect(viewer).toEqual({ staffUserId: 'u-1', clientId: 'c-duce', email: 'tomas@finsera.nl' });
    expect(viewer.portalUserId).toBeUndefined();
  });

  it('holds a staff session to the client it was opened for', async () => {
    // Staff may open every portal — one at a time, each with its own login. A session
    // created at Duce is not a key to DocHorse; signing in there is a redirect, not a risk.
    const guard = build(DOCHORSE, staffSession);
    await expect(guard.canActivate(ctx({ headers: { host: 'dochorse.finsera.nl', cookie: 'psid=secret' } })))
      .rejects.toThrow(/Not your portal/);
  });
});
