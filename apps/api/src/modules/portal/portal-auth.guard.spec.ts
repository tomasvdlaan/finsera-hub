import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';
import { PortalAuthGuard } from './portal-auth.guard.js';
import type { PortalUsersService } from './portal-users.service.js';

/**
 * Only the signature check is stubbed. Verifying that `jose` verifies would prove the
 * mock agrees with itself; what is worth testing is what this guard does with a token
 * `jose` has already accepted.
 */
vi.mock('jose', async (importOriginal) => ({
  ...(await importOriginal<typeof import('jose')>()),
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => vi.fn()),
}));

const accepts = (payload: Record<string, unknown>) =>
  vi.mocked(jwtVerify).mockResolvedValue({ payload } as never);

/**
 * The guard's own logic, without a live Zitadel.
 *
 * What is worth testing here is not JWT verification — that is `jose`, and re-testing it
 * would only prove the mock agrees with itself. It is the configuration handling around
 * it, because every failure mode here is silent: a portal that accepts internal tokens
 * looks exactly like a portal that works.
 */
describe('PortalAuthGuard', () => {
  const original = { ...process.env };
  let resolveFromSubject: ReturnType<typeof vi.fn>;
  let guard: PortalAuthGuard;

  beforeEach(() => {
    resolveFromSubject = vi.fn();
    guard = new PortalAuthGuard({ resolveFromSubject } as unknown as PortalUsersService);
    process.env.ZITADEL_ISSUER = 'https://example.zitadel.cloud';
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('refuses every request when the portal audience is unset', async () => {
    delete process.env.ZITADEL_PORTAL_CLIENT_ID;

    // Fail closed. Verifying without an audience would accept any token this Zitadel
    // instance ever issued, an internal user's included.
    await expect(guard.verifyToken('a.b.c')).rejects.toThrow(/not configured/i);
    expect(resolveFromSubject).not.toHaveBeenCalled();
  });

  it('refuses to start when the portal shares the internal application', () => {
    process.env.ZITADEL_CLIENT_ID = '123';
    process.env.ZITADEL_PORTAL_CLIENT_ID = '123';

    // Not a missing configuration but a wrong one, and the symptom would be an internal
    // token quietly working at the portal — so it is fatal rather than a warning.
    expect(() => guard.onModuleInit()).toThrow(/its own Zitadel application/);
  });

  it('starts, with a warning, when the portal is simply not configured yet', () => {
    delete process.env.ZITADEL_PORTAL_CLIENT_ID;
    process.env.ZITADEL_CLIENT_ID = '123';

    // The portal has no endpoints yet. Failing the whole platform's boot over a feature
    // nobody can reach would be theatre — requests are refused instead.
    expect(() => guard.onModuleInit()).not.toThrow();
  });

  it('rejects an opaque token instead of reporting a generic failure', async () => {
    process.env.ZITADEL_PORTAL_CLIENT_ID = '456';
    process.env.ZITADEL_CLIENT_ID = '123';

    // Zitadel issues opaque access tokens by default, which cannot be checked offline.
    // A 401 with no explanation sent someone hunting last time; this one names the setting.
    await expect(guard.verifyToken('opaque-token')).rejects.toThrow(/Opaque access token/);
  });

  it('never resolves a visitor from a token it could not verify', async () => {
    process.env.ZITADEL_PORTAL_CLIENT_ID = '456';
    process.env.ZITADEL_CLIENT_ID = '123';
    vi.mocked(jwtVerify).mockRejectedValue(new Error('signature verification failed'));

    // Signature check first, identity lookup second. Reversing them would make the portal
    // user table the only thing standing between a forged token and a client's data.
    await expect(guard.verifyToken('not.a.jwt')).rejects.toThrow(/Invalid token/);
    expect(resolveFromSubject).not.toHaveBeenCalled();
  });

  // ── the role, which is the check that actually authorises ──

  describe('once the signature and audience are accepted', () => {
    beforeEach(() => {
      process.env.ZITADEL_PORTAL_CLIENT_ID = '456';
      process.env.ZITADEL_CLIENT_ID = '123';
      delete process.env.ZITADEL_PROJECT_ID;
    });

    it('refuses a token carrying the right audience but no portal role', async () => {
      // The reason this check exists: Zitadel will issue a token containing an audience
      // the holder has no grant for, so a passing `aud` restates what the client asked
      // for. Roles come from grants, and cannot be requested into existence.
      accepts({ sub: 'sub-1' });

      await expect(guard.verifyToken('a.b.c')).rejects.toThrow(/Invalid token/);
      expect(resolveFromSubject).not.toHaveBeenCalled();
    });

    it('refuses an internal user holding an internal role', async () => {
      accepts({
        sub: 'sub-employee',
        'urn:zitadel:iam:org:project:roles': { internal: { orgId: 'finsera.nl' } },
      });

      // Refused before anyone asks which client this is — the portal user lookup is not
      // what keeps employees out, and must never be the only thing that does.
      await expect(guard.verifyToken('a.b.c')).rejects.toThrow(/Invalid token/);
      expect(resolveFromSubject).not.toHaveBeenCalled();
    });

    it('resolves a visitor holding the portal role', async () => {
      accepts({
        sub: 'sub-client',
        'urn:zitadel:iam:org:project:roles': { portal_client: { orgId: 'finsera.nl' } },
      });
      resolveFromSubject.mockResolvedValue({
        portalUserId: 'pu-1', clientId: 'c-1', email: 'them@aclient.nl',
      });

      expect(await guard.verifyToken('a.b.c')).toMatchObject({ clientId: 'c-1' });
      expect(resolveFromSubject).toHaveBeenCalledWith('sub-client');
    });

    it('still refuses a portal role that was never invited', async () => {
      accepts({
        sub: 'sub-uninvited',
        'urn:zitadel:iam:org:project:roles': { portal_client: { orgId: 'finsera.nl' } },
      });
      resolveFromSubject.mockRejectedValue(new Error('No portal access'));

      // The role says "a client"; the invitation says "which client". Both are required,
      // and the role alone does not name whose data anyone gets.
      await expect(guard.verifyToken('a.b.c')).rejects.toThrow(/No portal access/);
    });
  });
});
