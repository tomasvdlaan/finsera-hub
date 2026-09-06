import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZitadelAdminService } from './zitadel-admin.service.js';
import type { PortalHostService } from './portal-host.service.js';

/**
 * The three calls that turn an email address into a client login.
 *
 * `fetch` is stubbed rather than a Zitadel instance being stood up: what is worth pinning
 * here is not that HTTP works, it is the order of the calls, that a second press repairs a
 * half-made invitation instead of refusing it, and that the code never appears anywhere but
 * inside the link.
 */
describe('ZitadelAdminService', () => {
  let zitadel: ZitadelAdminService;
  let calls: Array<{ path: string; body: Record<string, unknown> }>;
  const env = { ...process.env };

  /** Answers each endpoint in turn; `overrides` replaces one of them for a case. */
  const respond = (overrides: Record<string, () => Response> = {}) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname + (new URL(url).search || '');
        calls.push({ path, body: JSON.parse(String(init.body ?? '{}')) });

        // Exact first, then a suffix: `/v2/users` must not swallow `/v2/users/x/invite_code`,
        // which is how the first version of this helper made a passing test lie.
        const hit =
          Object.entries(overrides).find(([p]) => path === p) ??
          Object.entries(overrides).find(([p]) => path.endsWith(p));
        if (hit) return hit[1]();

        if (path === '/v2/users') return json({ result: [] });
        if (path === '/v2/users/human') return json({ userId: 'zit-1' });
        if (path.endsWith('/grants')) return json({});
        if (path.endsWith('/invite_code')) return json({ inviteCode: 'the-code' });
        return json({});
      }),
    );
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    calls = [];
    process.env.ZITADEL_ISSUER = 'https://finsera.example';
    process.env.ZITADEL_ADMIN_TOKEN = 'pat-xyz';
    process.env.ZITADEL_PROJECT_ID = 'proj-1';
    delete process.env.ZITADEL_ORG_ID;
    delete process.env.ZITADEL_INVITE_URL;
    // The link now points at the login host, so the service needs to know it.
    zitadel = new ZitadelAdminService({ authHost: 'portal.finsera.example' } as PortalHostService);
    respond();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
  });

  it('creates the account, grants the portal role, and returns a link', async () => {
    const invite = await zitadel.inviteToPortal({ email: 'anna@dochorse.nl', displayName: 'Anna de Vries' });

    expect(calls.map((c) => c.path)).toEqual([
      '/v2/users',
      '/v2/users/human',
      '/management/v1/users/zit-1/grants',
      '/v2/users/zit-1/invite_code',
    ]);
    // The role is the gate a client is refused at; granting it is not optional decoration.
    expect(calls[2]!.body).toMatchObject({ projectId: 'proj-1', roleKeys: ['portal_client'] });
    // returnCode, never sendCode: Zitadel emailing the link is the thing this replaces.
    expect(calls[3]!.body).toEqual({ returnCode: {} });

    expect(invite.zitadelUserId).toBe('zit-1');
    /*
     * Our address, not Zitadel's.
     *
     * The link used to go straight to Zitadel's invite page, which is why a client who
     * finished registering landed on Zitadel's console: that page completes an OIDC request
     * when the password is set, and a link written here has none to give it. The request has
     * to be minted when the link is clicked, so the click has to reach us first.
     */
    expect(invite.url).toBe(
      'https://portal.finsera.example/api/portal-auth/invite?userId=zit-1&code=the-code',
    );
  });

  it('re-uses an account that already exists rather than refusing', async () => {
    respond({ '/v2/users': () => json({ result: [{ userId: 'zit-existing' }] }) });

    const invite = await zitadel.inviteToPortal({ email: 'anna@dochorse.nl' });

    // No second account for one person: pressing the button again after a failed grant is
    // the repair, so it must converge rather than pile up users.
    expect(calls.map((c) => c.path)).not.toContain('/v2/users/human');
    expect(invite.zitadelUserId).toBe('zit-existing');
  });

  it('treats an existing grant as the state it wanted', async () => {
    respond({
      '/grants': () => json({ code: 6, message: 'User grant already exists' }, 409),
    });

    // The half-made invitation this repairs: account created, grant written, code never
    // issued. A second press must finish the job, not report the grant as a failure.
    await expect(zitadel.inviteToPortal({ email: 'anna@dochorse.nl' })).resolves.toMatchObject({
      zitadelUserId: 'zit-1',
    });
  });

  it('says what to fix when the credential is missing, and does not call out', async () => {
    delete process.env.ZITADEL_ADMIN_TOKEN;
    zitadel = new ZitadelAdminService({ authHost: 'portal.finsera.example' } as PortalHostService);

    expect(zitadel.configured).toBe(false);
    expect(zitadel.unconfiguredReason).toMatch(/ZITADEL_ADMIN_TOKEN/);
    await expect(zitadel.inviteToPortal({ email: 'a@b.nl' })).rejects.toThrow(/ZITADEL_ADMIN_TOKEN/);
    expect(calls).toHaveLength(0);
  });

  it('refuses to invite when no project is configured, rather than granting nothing', async () => {
    delete process.env.ZITADEL_PROJECT_ID;
    zitadel = new ZitadelAdminService({ authHost: 'portal.finsera.example' } as PortalHostService);

    // An account with no grant signs in successfully and is refused at the portal with
    // "Geen toegang" — the failure that looks like the platform being broken.
    await expect(zitadel.inviteToPortal({ email: 'a@b.nl' })).rejects.toThrow(/ZITADEL_PROJECT_ID/);
  });

  it('carries Zitadel’s own complaint into the error', async () => {
    respond({
      '/v2/users/human': () => json({ message: 'Errors.User.Email.Invalid' }, 400),
    });

    // Otherwise diagnosing a rejected field means reading somebody else's server logs.
    await expect(zitadel.inviteToPortal({ email: 'not-an-email' })).rejects.toThrow(
      /Errors.User.Email.Invalid/,
    );
  });

  it('mints a fresh link for an account that already has one', async () => {
    const again = await zitadel.reissue('zit-7');

    expect(calls.map((c) => c.path)).toEqual(['/v2/users/zit-7/invite_code']);
    expect(again.url).toContain('userId=zit-7');
  });

  it('lets the link shape be corrected without a deploy of new code', async () => {
    // The URL belongs to Zitadel's login UI and has changed across versions. A link that
    // 404s is the one failure a client cannot work around, so it is configuration. It now
    // shapes the page we forward to rather than the link we send.
    process.env.ZITADEL_INVITE_URL = 'https://id.finsera.nl/invite?u={userId}&c={code}';
    zitadel = new ZitadelAdminService({ authHost: 'portal.finsera.example' } as PortalHostService);

    expect(
      zitadel.zitadelInviteUrl('zit-1', 'the-code', { param: 'authRequest', value: 'V2_9' }),
    ).toBe('https://id.finsera.nl/invite?u=zit-1&c=the-code&authRequest=V2_9');
  });

  it('appends the auth request under the name Zitadel gave it', () => {
    /*
     * The name travels with the value, and that is the whole point.
     *
     * v2 calls it `authRequest`, v1 calls it `authRequestID`, and which one an instance uses
     * is Zitadel's choice made when it answers the authorize call. Assuming either name is
     * how the first attempt at this shipped a link with no request on it at all — a silent
     * fallback, and a client back on the console.
     */
    expect(
      zitadel.zitadelInviteUrl('zit-1', 'the-code', { param: 'authRequest', value: 'V2_9' }),
    ).toBe(
      'https://finsera.example/ui/v2/login/verify?userId=zit-1&code=the-code&invite=true&authRequest=V2_9',
    );
    expect(
      zitadel.zitadelInviteUrl('zit-1', 'the-code', { param: 'authRequestID', value: 'r1' }),
    ).toBe(
      'https://finsera.example/ui/v2/login/verify?userId=zit-1&code=the-code&invite=true&authRequestID=r1',
    );
    expect(zitadel.zitadelInviteUrl('zit-1', 'the-code', null)).toBe(
      'https://finsera.example/ui/v2/login/verify?userId=zit-1&code=the-code&invite=true',
    );
  });

  it('can be sent straight at Zitadel again by an operator', async () => {
    // The hop is the one step between a client and their account. If it misbehaves in a way
    // nobody predicted, the previous behaviour is an environment variable away — no deploy,
    // no revert, at the cost of landing on the wrong page again.
    process.env.PORTAL_INVITE_VIA_HUB = 'off';
    try {
      const invite = await zitadel.inviteToPortal({ email: 'anna@dochorse.nl' });
      expect(invite.url).toBe(
        'https://finsera.example/ui/v2/login/verify?userId=zit-1&code=the-code&invite=true',
      );
    } finally {
      delete process.env.PORTAL_INVITE_VIA_HUB;
    }
  });
});
