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
