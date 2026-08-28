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

/**
 * Signing out has to work on the session most in need of it.
 *
 * `signoutRedirect` asks Zitadel to end its own session too, and that is exactly the call
 * most likely to fail on an expired or revoked token — there may be no `id_token_hint` the
 * provider will still accept. If that rejection were allowed to propagate, the stored
 * session would survive the click, which is the same dead end as having no button at all.
 */
describe('signing out', () => {
  const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');

  it('drops the local session even when the provider refuses the redirect', () => {
    const body = source.slice(source.indexOf('export const logout'));
    expect(body).toMatch(/catch\s*\{[^}]*removeUser/s);
  });

  it('offers a way to drop a session without navigating anywhere', () => {
    // What clearing the tab's storage by hand used to do, and the only cure for a token the
    // API rejects: `signoutRedirect` navigates away before the reason can be read.
    expect(source).toMatch(/export const clearSession\s*=\s*\(\)\s*=>\s*userManager\.removeUser/);
  });
});

/**
 * The avatar must never be gated on the API agreeing to describe you.
 *
 * This is the lockout itself, asserted where it happened. `me` comes from `/core/me`; when
 * that call failed the avatar vanished, taking Sign out with it, and the session could only
 * be cleared through developer tools. The name on the token is available whether or not the
 * platform will speak to you, so it is what the menu falls back to.
 */
describe('the way out of a bad session', () => {
  const topnav = readFileSync(new URL('../shell/TopNav.tsx', import.meta.url), 'utf8');

  it('renders the avatar from the token when the API will not say who you are', () => {
    expect(topnav).toMatch(/const name = me\?\.displayName \?\? fallbackName/);
  });

  it('does not gate the avatar on /core/me', () => {
    // The exact expression that caused it. Anything reintroducing `{me && (` around the
    // menu puts Sign out back behind the call most likely to be the reason you need it.
    expect(topnav).not.toContain('{me && (\n          <div className="me"');
    expect(topnav).toMatch(/\{name && \(\s*<div className="me"/);
  });
});
