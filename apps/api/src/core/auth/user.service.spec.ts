import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { users } from '../db/core.schema.js';
import { resetDb, testDb, truncate } from '../../test/db.js';
import { UserService } from './user.service.js';

/**
 * Who is allowed to become an internal user.
 *
 * This used to be "anyone holding a valid token", which was reasonable while the only
 * people Zitadel would issue a token to were people we hired. The client portal ends
 * that: clients now authenticate against the same instance, so first sign-in is no longer
 * evidence of belonging here.
 */
describe('UserService provisioning', () => {
  let service: UserService;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE core.users CASCADE`);
    service = new UserService(testDb);
  });

  it('refuses to provision a subject without the internal role', async () => {
    // The attack this closes: a client authenticates against the internal application and
    // is handed a member account — access to every client's data, granted silently, by a
    // login that looked completely ordinary.
    await expect(
      service.resolveFromClaims({ sub: 'sub-client', email: 'them@aclient.nl', roles: [] }, 'tok'),
    ).rejects.toThrow(/No access to this platform/);

    const rows = await testDb.select().from(users);
    expect(rows, 'a refused sign-in must not leave a user behind').toHaveLength(0);
  });

  it('refuses a portal role as though it were no role at all', async () => {
    await expect(
      service.resolveFromClaims(
        { sub: 'sub-client', email: 'them@aclient.nl', roles: ['portal_client'] },
        'tok',
      ),
    ).rejects.toThrow(/No access to this platform/);
  });

  it('refuses when the token carries no roles claim whatsoever', async () => {
    // The shape of a Zitadel misconfiguration ("Assert Roles on Authentication" left off).
    // It must fail closed: locked out is recoverable, silently admitted is not.
    await expect(
      service.resolveFromClaims({ sub: 'sub-x', email: 'x@finsera.nl' }, 'tok'),
    ).rejects.toThrow(/No access to this platform/);
  });

  it('provisions a subject that holds the internal role', async () => {
    const actor = await service.resolveFromClaims(
      { sub: 'sub-colleague', email: 'colleague@finsera.nl', roles: ['internal'] },
      'tok',
    );
    // First user becomes admin — otherwise a fresh install has nobody who can grant anything.
    expect(actor.role).toBe('admin');
  });

  it('still authenticates an existing user whose token carries no role', async () => {
    // The gate is on CREATION, not on authentication. Gating authentication would lock out
    // every existing user the moment this shipped and before Zitadel was configured — and
    // an existing row is already an authorisation decision somebody made deliberately.
    await testDb.insert(users).values({
      id: crypto.randomUUID(),
      oidcSubject: 'sub-established',
      email: 'tomas@finsera.nl',
      displayName: 'Tomas',
      role: 'admin',
    });

    const actor = await service.resolveFromClaims({ sub: 'sub-established', roles: [] }, 'tok');
    expect(actor.role).toBe('admin');
  });

  it('does not re-provision, or change the role of, a returning user', async () => {
    await service.resolveFromClaims(
      { sub: 'sub-first', email: 'first@finsera.nl', roles: ['internal'] },
      'tok',
    );
    await service.resolveFromClaims(
      { sub: 'sub-first', email: 'first@finsera.nl', roles: ['internal'] },
      'tok',
    );

    const rows = await testDb.select().from(users).where(eq(users.oidcSubject, 'sub-first'));
    expect(rows).toHaveLength(1);
  });
});

/**
 * Keeping a name in step with the identity provider.
 *
 * The bug this closes is a quiet one: somebody changes their name in Zitadel and this platform
 * shows the old one forever, on every task, timesheet and person page. Nothing errors, so
 * nothing prompts anybody to look, and `updatePerson` accepts no name to correct it with.
 *
 * `fetchUserInfo` is stubbed throughout — the real one is a network call to the issuer, and
 * what is worth testing is the decision made about its answer, not the call.
 */
describe('UserService profile refresh', () => {
  let service: UserService;
  const SUB = 'sub-renamed';

  /** The stored row as it stands, by subject. */
  const stored = async () =>
    (await testDb.select().from(users).where(eq(users.oidcSubject, SUB)))[0]!;

  /** Replace the issuer call with a fixed answer, and count how often it is asked. */
  function stubUserInfo(answer: { name?: string; email?: string } | null) {
    const calls = { count: 0 };
    service.fetchUserInfo = async () => {
      calls.count += 1;
      return answer === null ? null : { sub: SUB, ...answer };
    };
    return calls;
  }

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE core.users CASCADE`);
    service = new UserService(testDb);
    await testDb.insert(users).values({
      id: crypto.randomUUID(),
      oidcSubject: SUB,
      email: 'oldname@finsera.nl',
      displayName: 'Old Name',
      role: 'member',
    });
  });

  it('adopts a name and email changed upstream', async () => {
    stubUserInfo({ name: 'New Name', email: 'newname@finsera.nl' });

    await service.resolveFromClaims({ sub: SUB, roles: [] }, 'tok');

    const row = await stored();
    expect(row.displayName).toBe('New Name');
    expect(row.email).toBe('newname@finsera.nl');
  });

  it('asks the issuer once, not on every request', async () => {
    // resolveFromClaims runs per request, so an unthrottled refresh would put a network call
    // in front of every single API call the shell makes.
    const calls = stubUserInfo({ name: 'New Name', email: 'newname@finsera.nl' });

    await service.resolveFromClaims({ sub: SUB, roles: [] }, 'tok');
    await service.resolveFromClaims({ sub: SUB, roles: [] }, 'tok');
    await service.resolveFromClaims({ sub: SUB, roles: [] }, 'tok');

    expect(calls.count).toBe(1);
  });

  it('leaves role and employment alone — the issuer has no opinion on those', async () => {
    // A profile refresh that reset a role would be a privilege change wearing a name change's
    // clothes. Promote first, then refresh, and the promotion must survive.
    await testDb.update(users).set({ role: 'admin', jobTitle: 'Partner' }).where(eq(users.oidcSubject, SUB));
    stubUserInfo({ name: 'New Name', email: 'newname@finsera.nl' });

    const actor = await service.resolveFromClaims({ sub: SUB, roles: [] }, 'tok');

    expect(actor.role).toBe('admin');
    const row = await stored();
    expect(row.role).toBe('admin');
    expect(row.jobTitle).toBe('Partner');
    expect(row.isActive).toBe(true);
  });

  it('keeps the stored name when the issuer is unreachable', async () => {
    // fetchUserInfo swallows its own failures and returns null. Signing in must still work,
    // with the name that is already known, rather than blanking it.
    stubUserInfo(null);

    const actor = await service.resolveFromClaims({ sub: SUB, roles: [] }, 'tok');

    expect(actor.userId).toBeTruthy();
    expect((await stored()).displayName).toBe('Old Name');
  });

  it('does not overwrite a good name with an empty one', async () => {
    // A userinfo response missing `name` must fall through to the email and then to what is
    // stored — never to undefined, which the column rejects and which would 500 the request.
    stubUserInfo({ email: 'oldname@finsera.nl' });

    await service.resolveFromClaims({ sub: SUB, roles: [] }, 'tok');

    expect((await stored()).displayName).toBe('oldname@finsera.nl');
  });

  it('does not call the issuer for a deactivated account', async () => {
    // Refused on the way in, without a round trip spent on somebody being turned away.
    await testDb.update(users).set({ isActive: false }).where(eq(users.oidcSubject, SUB));
    const calls = stubUserInfo({ name: 'New Name' });

    await expect(service.resolveFromClaims({ sub: SUB, roles: [] }, 'tok')).rejects.toThrow(
      /deactivated/,
    );
    expect(calls.count).toBe(0);
  });
});
