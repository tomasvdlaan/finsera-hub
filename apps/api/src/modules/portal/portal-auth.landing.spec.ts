import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { PortalAuthController } from './portal-auth.controller.js';
import type { PortalHostService } from './portal-host.service.js';
import type { PortalIdentityService } from './portal-identity.service.js';
import type { PortalOidcService } from './portal-oidc.service.js';
import type { PortalSessionsService } from './portal-sessions.service.js';
import type { AuditService } from '../../core/audit/audit.service.js';
import type { EventBus } from '../../core/events/event-bus.service.js';
import type { Database } from '../../core/db/db.module.js';

/**
 * Where somebody ends up after activating their account.
 *
 * A registration link goes to Zitadel's own page, which knows nothing about client portals:
 * it finishes on the login policy's default redirect, which is the login host. So the last
 * hop — from `portal.finsera.nl` to `duce.finsera.nl` — is entirely ours, and it is the one
 * step nobody sees until a real client is standing on the wrong screen.
 *
 * Asserted at the controller rather than end to end, because the interesting part is a
 * branch in the callback and not the HTTP around it: a client whose login landed on the host
 * that belongs to nobody is sent on to the one that is theirs.
 */
/*
 * What this file does NOT prove, said here because it once looked as though it did.
 *
 * These call `controller.callback` directly, so they assert where a client goes *once
 * Zitadel has returned* — never that it returns. It does not, after an activation mail:
 * Zitadel finishes with no auth request in context and falls back to its Default Redirect
 * URI, whose stock value is the management console. That is a setting on the instance, not
 * a branch in this file, and no test here can reach it.
 */
describe('landing after registration', () => {
  const AUTH_HOST = 'portal.finsera.nl';
  const CLIENT_HOST = 'duce.finsera.nl';

  const build = (identify: () => Promise<unknown>) => {
    const redirect = vi.fn();
    const res = {
      redirect,
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      end: vi.fn(),
      // The callback clears the login cookie on its way through, whichever branch it takes.
      clearCookie: vi.fn(),
      cookie: vi.fn(),
      type: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const req = {
      protocol: 'https',
      headers: { host: AUTH_HOST },
      get: () => AUTH_HOST,
    } as unknown as Request;

    const hosts = {
      authHost: AUTH_HOST,
      hostFor: (slug: string) => `${slug}.finsera.nl`,
      slugOf: vi.fn().mockResolvedValue('duce'),
      resolve: vi.fn(async (host?: string) => {
        if (host === AUTH_HOST) return { kind: 'auth', host: AUTH_HOST };
        if (host === CLIENT_HOST) {
          return { kind: 'client', host: CLIENT_HOST, slug: 'duce', clientId: 'c-1', clientName: 'Duce' };
        }
        return null;
      }),
    } as unknown as PortalHostService;

    const oidc = {
      completeLogin: vi.fn().mockResolvedValue({
        accessToken: 'a.b.c',
        // The login began on the login host: that is what a link from an activation mail
        // looks like, and it is the case this whole test exists for.
        targetHost: AUTH_HOST,
        next: '/',
        binding: null,
      }),
    } as unknown as PortalOidcService;

    const sessions = {
      issueTicket: vi.fn().mockResolvedValue('one-time-ticket'),
    } as unknown as PortalSessionsService;

    const controller = new PortalAuthController(
      hosts,
      oidc,
      { identify } as unknown as PortalIdentityService,
      sessions,
      { record: vi.fn() } as unknown as AuditService,
      { publish: vi.fn() } as unknown as EventBus,
      { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } as unknown as Database,
    );

    return { controller, req, res, redirect, hosts, sessions };
  };

  it('sends a freshly registered client on to their own portal', async () => {
    const { controller, req, res, redirect, sessions } = build(async () => ({
      kind: 'client',
      portalUserId: 'pu-1',
      clientId: 'c-1',
      email: 'anna@duce.nl',
    }));

    await controller.callback(req, res, 'the-code', 'the-state');

    // The whole answer to "does activation land them in the right place": a 302 to their own
    // host, carrying a ticket that only their browser can redeem there.
    const [status, location] = redirect.mock.calls[0] as [number, string];
    expect(status).toBe(302);
    expect(new URL(location).host).toBe(CLIENT_HOST);
    expect(new URL(location).pathname).toBe('/api/portal-auth/complete');
    expect(new URL(location).searchParams.get('t')).toBe('one-time-ticket');

    // No session is created on the login host itself. It resolves without consulting
    // crm.clients, so a session there would outlive the client being archived.
    expect(sessions.issueTicket).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'client', clientId: 'c-1' }),
      CLIENT_HOST,
      '/',
      null,
    );
  });

  it('says so plainly when the client has no portal address yet', async () => {
    const { controller, req, res, redirect, hosts } = build(async () => ({
      kind: 'client',
      portalUserId: 'pu-1',
      clientId: 'c-1',
      email: 'anna@duce.nl',
    }));
    (hosts.slugOf as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await controller.callback(req, res, 'the-code', 'the-state');

    // Not a redirect to nowhere and not a blank page: there is no portal to send them to,
    // and the person reading it needs to know that rather than retrying.
    expect(redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('does not hand an employee a client session on the login host', async () => {
    const { controller, req, res, redirect } = build(async () => ({
      kind: 'staff',
      staffUserId: 'u-1',
      email: 'tomas@finsera.nl',
    }));

    await controller.callback(req, res, 'the-code', 'the-state');

    // A portal is always somebody's, and this host is nobody's. The colleague is told to
    // open a client's portal from the dashboard instead.
    expect(redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
