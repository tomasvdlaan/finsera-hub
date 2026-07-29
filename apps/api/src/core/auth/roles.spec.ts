import { afterEach, describe, expect, it } from 'vitest';
import type { JWTPayload } from 'jose';
import { hasRole, rolesFrom } from './roles.js';

/**
 * Reading roles out of a token.
 *
 * Small surface, but it is what separates an employee from a client now that both
 * authenticate against the same Zitadel instance — and every way it can fail is quiet.
 */
describe('rolesFrom', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  const claim = (name: string, roles: Record<string, unknown>): JWTPayload =>
    ({ sub: 'user-1', [name]: roles }) as JWTPayload;

  it('reads the legacy flat claim', () => {
    const payload = claim('urn:zitadel:iam:org:project:roles', {
      internal: { orgId: 'finsera.nl' },
    });
    expect(rolesFrom(payload)).toEqual(['internal']);
  });

  it('reads the project-scoped claim when a project id is configured', () => {
    process.env.ZITADEL_PROJECT_ID = '99';
    const payload = claim('urn:zitadel:iam:org:project:99:roles', {
      portal_client: { orgId: 'finsera.nl' },
    });
    expect(rolesFrom(payload)).toEqual(['portal_client']);
  });

  it('ignores another project’s roles', () => {
    process.env.ZITADEL_PROJECT_ID = '99';
    // A role granted in a different project is not a role here, and reading it as one
    // would import someone else's authorisation decisions.
    const payload = claim('urn:zitadel:iam:org:project:12345:roles', {
      internal: { orgId: 'elsewhere.nl' },
    });
    expect(rolesFrom(payload)).toEqual([]);
  });

  it('returns nothing for a token carrying no roles at all', () => {
    // The likely shape of a misconfiguration: "Assert Roles on Authentication" left off.
    // Empty means every role check fails, which locks people out loudly instead of
    // letting them in quietly.
    expect(rolesFrom({ sub: 'user-1' } as JWTPayload)).toEqual([]);
    expect(hasRole({ sub: 'user-1' } as JWTPayload, 'internal')).toBe(false);
  });

  it('is not fooled by a claim that is a string rather than an object', () => {
    // Object.keys('admin') would yield ['0','1','2','3','4'] rather than throwing, so a
    // malformed claim must be rejected on shape rather than trusted to be well-formed.
    const payload = { sub: 'u', 'urn:zitadel:iam:org:project:roles': 'internal' } as JWTPayload;
    expect(rolesFrom(payload)).toEqual([]);
  });

  it('does not confuse one role for another by prefix', () => {
    const payload = claim('urn:zitadel:iam:org:project:roles', {
      portal_client_readonly: { orgId: 'finsera.nl' },
    });
    expect(hasRole(payload, 'portal_client')).toBe(false);
  });
});
