import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZitadelTokens } from '../../core/auth/zitadel.tokens.js';
import { PortalOidcService } from './portal-oidc.service.js';

/**
 * The authorize redirect, read as a URL.
 *
 * `beginLogin` builds the one address a client's browser is sent to, and everything that
 * matters about the login is a query parameter on it — so it is asserted by parsing the
 * thing itself rather than by grepping the source that produced it.
 */
describe('PortalOidcService.beginLogin', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.ZITADEL_ISSUER = 'https://finsera.example';
    process.env.ZITADEL_PORTAL_CLIENT_ID = 'portal-client';
    process.env.PORTAL_SESSION_SECRET = 'a-secret-long-enough-for-hs256-signing';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  const authorize = async () => {
    const { authorizeUrl } = await new PortalOidcService(new ZitadelTokens()).beginLogin({
      redirectUri: 'https://portal.finsera.nl/api/portal-auth/callback',
      targetHost: 'portal.finsera.nl',
      next: '/rapporten',
    });
    return new URL(authorizeUrl);
  };

  it('asks Zitadel for a Dutch login page', async () => {
    // A client arriving from a Dutch report should not meet an English login screen. The
    // instance-wide alternative is Admin API only, so this parameter is the whole mechanism
    // — dropped, the screen reverts to English and nothing fails.
    expect((await authorize()).searchParams.get('ui_locales')).toBe('nl');
  });

  it('still asks for a code with PKCE and the roles scope', async () => {
    const url = await authorize();
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('urn:zitadel:iam:org:project:roles');
  });

  it('refuses to start a login it cannot finish', async () => {
    delete process.env.ZITADEL_PORTAL_CLIENT_ID;
    await expect(authorize()).rejects.toThrow(/not configured/);
  });
});
