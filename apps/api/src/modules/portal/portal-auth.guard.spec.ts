import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalAuthGuard } from './portal-auth.guard.js';
import type { PortalUsersService } from './portal-users.service.js';

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

  it('refuses to start when the portal shares the internal project', () => {
    process.env.ZITADEL_CLIENT_ID = '123';
    process.env.ZITADEL_PORTAL_CLIENT_ID = '123';

    // Not a missing configuration but a wrong one, and the symptom would be an internal
    // token quietly working at the portal — so it is fatal rather than a warning.
    expect(() => guard.onModuleInit()).toThrow(/separate Zitadel project/);
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

    // Signature check first, identity lookup second. Reversing them would make the portal
    // user table the only thing standing between a forged token and a client's data.
    await expect(guard.verifyToken('not.a.jwt')).rejects.toThrow();
    expect(resolveFromSubject).not.toHaveBeenCalled();
  });
});
