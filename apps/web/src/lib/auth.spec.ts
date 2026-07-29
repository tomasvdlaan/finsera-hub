import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The internal app must ask Zitadel for project roles.
 *
 * Asserted against the source text rather than by importing the module: `auth.ts` builds a
 * UserManager at import time and reads `window.location`, so importing it here would need a
 * DOM environment purely to check one string. Crude, and it holds — what is worth protecting
 * is that the scope this app requests contains the roles URN.
 *
 * The regression it guards against already happened: this app requested
 * 'openid profile email' while the portal requested the roles scope too, so the API could
 * never see an internal role and no new colleague could be provisioned at all. Two SPAs
 * diverging silently is not something anything else would notice.
 */
describe('OIDC scope', () => {
  const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');

  it('requests the project roles scope', () => {
    expect(source).toContain("ROLES_SCOPE = 'urn:zitadel:iam:org:project:roles'");
    expect(source).toMatch(/scope:\s*`openid profile email \$\{ROLES_SCOPE\}`/);
  });

  it('still requests the basics', () => {
    expect(source).toContain('openid profile email');
  });
});
