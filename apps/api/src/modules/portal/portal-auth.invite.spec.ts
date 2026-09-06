import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { PortalAuthController } from './portal-auth.controller.js';
import type { PortalHostService } from './portal-host.service.js';
import type { PortalIdentityService } from './portal-identity.service.js';
import type { PortalOidcService } from './portal-oidc.service.js';
import type { PortalSessionsService } from './portal-sessions.service.js';
import type { ZitadelAdminService } from './zitadel-admin.service.js';
import type { AuditService } from '../../core/audit/audit.service.js';
import type { EventBus } from '../../core/events/event-bus.service.js';

/**
 * Opening an invitation.
 *
 * This file exists because the test next to it was not enough, and the way it fell short is
 * worth keeping in front of whoever reads this. `portal-auth.landing.spec.ts` calls
 * `controller.callback(...)` directly and asserts a freshly registered client is sent to
 * their own portal — which is true, and which never happened, because nothing was making
 * Zitadel call the callback. Its comment claims to be "the whole answer to does activation
 * land them in the right place"; it was half, and the missing half was invisible precisely
 * because the passing test began one step after the gap.
 *
 * So these start where the client starts: at the link in the mail.
 */
describe('opening an invitation', () => {
  const AUTH_HOST = 'portal.finsera.nl';
  const ISSUER = 'https://finsera.example';

  const build = (request: { param: 'authRequest'; value: string } | null) => {
    const redirect = vi.fn();
    const res = { redirect, cookie: vi.fn(), setHeader: vi.fn().mockReturnThis() } as unknown as Response;
    const req = {
      protocol: 'https',
      headers: { host: AUTH_HOST },
      get: () => AUTH_HOST,
    } as unknown as Request;

    const hosts = {
      authHost: AUTH_HOST,
      resolve: vi.fn(async () => ({ kind: 'auth', host: AUTH_HOST })),
    } as unknown as PortalHostService;

    const beginLogin = vi.fn().mockResolvedValue({
      authorizeUrl: `${ISSUER}/oauth/v2/authorize?client_id=portal`,
      stateCookie: 'signed-state',
    });
    const oidc = {
      beginLogin,
      authRequestIdFor: vi.fn().mockResolvedValue(request),
    } as unknown as PortalOidcService;

    const zitadel = {
      zitadelInviteUrl: (
        userId: string,
        code: string,
        req: { param: string; value: string } | null,
      ) =>
        `${ISSUER}/ui/v2/login/verify?userId=${userId}&code=${code}&invite=true` +
        (req ? `&${req.param}=${req.value}` : ''),
    } as unknown as ZitadelAdminService;

    const controller = new PortalAuthController(
      hosts,
      oidc,
      {} as unknown as PortalIdentityService,
      {} as unknown as PortalSessionsService,
      zitadel,
      { record: vi.fn() } as unknown as AuditService,
      { publish: vi.fn() } as unknown as EventBus,
      {} as never,
    );
    return { controller, req, res, redirect, beginLogin };
  };

  it('sends the client to Zitadel carrying a request for it to finish', async () => {
    const { controller, req, res, redirect } = build({ param: 'authRequest', value: 'V2_1' });

    await controller.invite(req, res, 'user-9', 'code-9');

    const [status, location] = redirect.mock.calls[0] as [number, string];
    expect(status).toBe(302);
    const url = new URL(location);
    // The whole bug in one assertion. Without this parameter Zitadel has no OIDC request to
    // complete when the password is set, so it keeps the client on its own console and the
    // callback — and everything the landing test proves about it — never runs.
    expect(url.searchParams.get('authRequest')).toBe('V2_1');
    expect(url.searchParams.get('userId')).toBe('user-9');
    expect(url.searchParams.get('code')).toBe('code-9');
  });

  it('remembers the login, so the callback can finish it', async () => {
    const { controller, req, res, beginLogin } = build({ param: 'authRequest', value: 'V2_1' });

    await controller.invite(req, res, 'user-9', 'code-9');

    expect(res.cookie).toHaveBeenCalled();
    // The login host, deliberately: a client is routed to their own portal from their
    // identity, so an invitation does not need to know which client it belongs to.
    expect(beginLogin).toHaveBeenCalledWith(
      expect.objectContaining({ targetHost: AUTH_HOST, next: '/' }),
    );
  });

  it('still opens the invitation when Zitadel will not mint a request', async () => {
    // Degrading to the old behaviour beats refusing: the client can set their password and
    // reach the portal by its own address. A wrong landing page is an annoyance; an account
    // they cannot create is not.
    const { controller, req, res, redirect } = build(null);

    await controller.invite(req, res, 'user-9', 'code-9');

    const [, location] = redirect.mock.calls[0] as [number, string];
    expect(location).toContain('/ui/v2/login/verify');
    expect(location).not.toContain('authRequest');
    // No cookie: there is no login in flight to remember.
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('refuses a link with nothing on it', async () => {
    const { controller, req, res } = build({ param: 'authRequest', value: 'V2_1' });
    await expect(controller.invite(req, res, undefined, 'code-9')).rejects.toThrow();
    await expect(controller.invite(req, res, 'user-9', undefined)).rejects.toThrow();
  });
});
