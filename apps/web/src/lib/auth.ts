import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';

/**
 * The roles scope, without which the API cannot tell a colleague from a client.
 *
 * `UserService.resolveFromClaims` requires the `internal` project role before it will
 * provision a new internal user — the check that stops a portal client who signs in against
 * this application from being handed a member account. Roles only reach the token if the
 * client asks for them, and this app asked for `openid profile email` while the portal app
 * asked for the roles scope too. So the gate could never pass here: no new colleague could
 * be provisioned at all, and the cause was one string, not the Zitadel configuration it
 * looked like.
 *
 * Asserted in auth.spec.ts, because the two applications diverging silently is exactly how
 * this happened and nothing else would notice.
 */
export const ROLES_SCOPE = 'urn:zitadel:iam:org:project:roles';

/**
 * OIDC Authorization Code + PKCE against Zitadel (spec §6, decision D5).
 *
 * Tokens live in sessionStorage rather than localStorage so they do not outlive the tab;
 * there is no client secret to protect — PKCE is what makes a browser client safe.
 */
export const userManager = new UserManager({
  authority: import.meta.env.VITE_ZITADEL_ISSUER,
  client_id: import.meta.env.VITE_ZITADEL_CLIENT_ID,
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: `openid profile email ${ROLES_SCOPE}`,
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
});

export const login = () => userManager.signinRedirect();
export const logout = () => userManager.signoutRedirect();
export const getUser = (): Promise<User | null> => userManager.getUser();

// The API client lives in lib/api.ts — it consumes getUser() for the bearer token.
