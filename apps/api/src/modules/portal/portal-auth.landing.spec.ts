import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { PortalAuthController } from './portal-auth.controller.js';
import type { PortalHostService } from './portal-host.service.js';
import type { PortalIdentityService } from './portal-identity.service.js';
import type { PortalOidcService } from './portal-oidc.service.js';
import type { PortalSessionsService } from './portal-sessions.service.js';
import type { PortalUsersService } from './portal-users.service.js';
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
      // Not consulted on this path: the callback knows who somebody is from the token.
      { clientForSubject: async () => null } as unknown as PortalUsersService,
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

/**
 * The activation hop, which exists for one reason: the link in the invitation must be on the
 * domain the invitation came from.
 *
 * A mail from `@finsera.nl` asking somebody to choose a password at
 * `<instance>.eu1.zitadel.cloud/...?code=…` is the shape of credential phishing, and real
 * invitations were being junked for it. So the client sees a `finsera.nl` link and this
 * sends them on. The tests that matter are the ones about *where* it sends them: a hop that
 * could be pointed somewhere else would be an open redirect carrying an invitation token.
 *
 * It also carries the destination across the trip. Zitadel ends an activation with no auth
 * request in context and falls back to its Default Redirect URI — one static address for the
 * whole instance, which cannot name a client — so which portal somebody belongs to is
 * remembered here and spent at `/welcome`.
 */
describe('the activation link on our own domain', () => {
  const AUTH_HOST = 'portal.finsera.nl';
  const ISSUER = 'https://finsera-dashboard-nsncri.eu1.zitadel.cloud';

  const CLIENT_SLUG = 'duce';
  const CLIENT_HOST = `${CLIENT_SLUG}.finsera.nl`;

  // Here rather than in each test: `activate` reads it, and a suite where the first test to
  // run decides whether the rest work is a suite that passes for the wrong reason.
  beforeEach(() => {
    process.env.ZITADEL_ISSUER = ISSUER;
  });

  const build = (
    host: string,
    options: {
      /** What the invitation's `userId` resolves to, or null for "nobody we know". */
      clientId?: string | null;
      /** The client's portal address, or null for a client who has none yet. */
      slug?: string | null;
      /** What the browser sends back, for the leg after Zitadel. */
      cookie?: string;
    } = {},
  ) => {
    const redirect = vi.fn();
    const sent: Array<{ status: number; body: string }> = [];
    const cookies: Array<{ name: string; value: string }> = [];
    const cleared: string[] = [];
    // `page()` writes through `status().type().setHeader().send()`, so the fake has to be
    // chainable all the way — a stub that stops one call short fails the test rather than
    // the code, which is what the first version of this did.
    let status = 200;
    const res = {
      redirect,
      status: (code: number) => {
        status = code;
        return res;
      },
      type: () => res,
      setHeader: () => res,
      send: (body: string) => sent.push({ status, body }),
      cookie: (name: string, value: string) => cookies.push({ name, value }),
      clearCookie: (name: string) => cleared.push(name),
    } as unknown as Response & { status: (c: number) => unknown };

    const hosts = {
      authHost: AUTH_HOST,
      hostFor: (slug: string) => `${slug}.finsera.nl`,
      slugOf: async () => (options.slug === undefined ? CLIENT_SLUG : options.slug),
      resolve: async (h: string | undefined) => {
        if (h === AUTH_HOST) return { kind: 'auth', host: AUTH_HOST };
        // Only a client this deployment actually serves resolves, which is what makes the
        // cookie a name rather than an address.
        if (h === CLIENT_HOST) return { kind: 'client', host: CLIENT_HOST, clientId: 'c1' };
        return null;
      },
    } as unknown as PortalHostService;

    const users = {
      clientForSubject: async () => (options.clientId === undefined ? 'c1' : options.clientId),
    } as unknown as PortalUsersService;

    const controller = new PortalAuthController(
      hosts,
      {} as PortalOidcService,
      {} as PortalIdentityService,
      {} as PortalSessionsService,
      users,
      {} as AuditService,
      {} as EventBus,
      {} as Database,
    );
    return {
      controller,
      redirect,
      sent,
      cookies,
      cleared,
      res: res as Response,
      req: {
        protocol: 'https',
        headers: { host, ...(options.cookie ? { cookie: options.cookie } : {}) },
      } as unknown as Request,
    };
  };

  it('sends an invitation on to the provider, carrying only what it was given', async () => {
    const { controller, redirect, req } = build(AUTH_HOST);

    await controller.activate(req, { redirect } as unknown as Response, 'user-1', 'code-1');

    expect(redirect).toHaveBeenCalledTimes(1);
    const [status, url] = redirect.mock.calls[0] as [number, string];
    // 302: the link is single-use, and a cached permanent redirect would never come back
    // here to be told so.
    expect(status).toBe(302);
    const target = new URL(url);
    expect(target.origin).toBe(ISSUER);
    expect(target.pathname).toBe('/ui/v2/login/verify');
    expect(target.searchParams.get('userId')).toBe('user-1');
    expect(target.searchParams.get('code')).toBe('code-1');
    expect(target.searchParams.get('invite')).toBe('true');
  });

  it('cannot be pointed anywhere but the issuer', async () => {
    /*
     * The open-redirect assertion. This hop carries an invitation token, so if a caller
     * could choose the destination it would be a way to harvest one. Only the invitation's
     * own two values travel; the origin and path come from the deployment's issuer.
     */
    const { controller, redirect, req } = build(AUTH_HOST);

    await controller.activate(
      req,
      { redirect } as unknown as Response,
      'https://evil.example/#',
      'code-1',
    );

    const [, url] = redirect.mock.calls[0] as [number, string];
    expect(new URL(url).origin).toBe(ISSUER);
    // The attempt survives as a value, encoded, rather than as part of the address.
    expect(new URL(url).searchParams.get('userId')).toBe('https://evil.example/#');
  });

  it('says so plainly when the link is incomplete, rather than redirecting to half a URL', async () => {
    const { controller, redirect, sent, req, res } = build(AUTH_HOST);

    await controller.activate(req, res, 'user-1', undefined);

    expect(redirect).not.toHaveBeenCalled();
    expect(sent[0]?.status).toBe(400);
  });

  it('is on the login host only, like every other route Zitadel is told about', async () => {
    const { controller, redirect, req } = build('duce.finsera.nl');

    await expect(
      controller.activate(req, { redirect } as unknown as Response, 'user-1', 'code-1'),
    ).rejects.toThrow();
    expect(redirect).not.toHaveBeenCalled();
  });

  /*
   * The other end of the same journey: where Zitadel sends them afterwards.
   *
   * In one describe with the hop that sets the cookie, because they are one mechanism
   * and a cookie set in one file and spent in another is exactly the kind of pair that
   * drifts. Everything below is about the two ways this can go wrong: sending somebody
   * nowhere, and sending them somewhere they should not go.
   */
  it('remembers whose portal an invitation belongs to, before the password exists', async () => {
    // The `userId` on the link is the Zitadel user id, and `attachSubject` wrote it onto the
    // portal user when the invitation was made — so the destination is knowable this early.
    const { controller, req, res, cookies } = build(AUTH_HOST);

    await controller.activate(req, res, 'zit-1', 'code-1');

    expect(cookies).toEqual([{ name: 'psx', value: CLIENT_SLUG }]);
  });

  it('remembers nothing it cannot resolve, and still lets the activation through', async () => {
    for (const options of [{ clientId: null }, { slug: null }]) {
      const { controller, req, res, cookies, redirect } = build(AUTH_HOST, options);

      await controller.activate(req, res, 'zit-1', 'code-1');

      // No cookie — a revoked login, or a client with no portal address yet.
      expect(cookies, JSON.stringify(options)).toEqual([]);
      // But the activation itself is untouched: a convenience that could not be arranged
      // must never cost somebody their account.
      expect(redirect).toHaveBeenCalledTimes(1);
      expect(new URL((redirect.mock.calls[0] as [number, string])[1]).origin).toBe(ISSUER);
    }
  });

  it('sends them to their own portal when it knows which one', async () => {
    const { controller, req, res, redirect, cleared } = build(AUTH_HOST, {
      cookie: `psx=${CLIENT_SLUG}`,
    });

    await controller.welcome(req, res);

    expect(redirect).toHaveBeenCalledWith(302, `https://${CLIENT_HOST}/api/portal-auth/login`);
    // Spent on the way out: it describes one trip through Zitadel and nothing afterwards.
    expect(cleared).toContain('psx');
  });

  it('grants nothing by arriving — it points at a login, not at a session', async () => {
    const { controller, req, res, redirect } = build(AUTH_HOST, { cookie: `psx=${CLIENT_SLUG}` });

    await controller.welcome(req, res);

    const [, url] = redirect.mock.calls[0] as [number, string];
    expect(new URL(url).pathname).toBe('/api/portal-auth/login');
  });

  it('ignores a slug this deployment does not serve', async () => {
    /*
     * The open-redirect assertion for the cookie. It holds a name rather than an address, and
     * the name is resolved the same way a `Host` header is — so the only destinations that
     * exist are clients already in `crm.clients`. A cookie somebody wrote by hand falls
     * through to the page.
     */
    const { controller, req, res, redirect, sent } = build(AUTH_HOST, {
      cookie: 'psx=evil.example',
    });

    await controller.welcome(req, res);

    expect(redirect).not.toHaveBeenCalled();
    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.body).toContain('Uw account is klaar');
  });

  it('still shows the page that is never wrong when there is no cookie', async () => {
    // A password reset, a link opened in another browser, cleared cookies. The fallback is
    // the whole reason this route is static: it reads nothing and resolves nothing.
    const { controller, req, res, redirect, sent } = build(AUTH_HOST);

    await controller.welcome(req, res);

    expect(redirect).not.toHaveBeenCalled();
    expect(sent[0]?.body).toContain('Naar uw portaal');
  });
});
