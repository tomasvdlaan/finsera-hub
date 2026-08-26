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

/**
 * Drop the stored session without going anywhere.
 *
 * What clearing the tab's storage by hand used to do, which was the only way out of a stale
 * session: the app trusted whatever was stored, the API rejected it, and every screen
 * failed while the shell went on believing you were signed in. `signoutRedirect` is not the
 * same thing — it needs the identity provider to still recognise the session, which for an
 * expired or revoked one it may not, and it navigates away before the reason can be read.
 */
export const clearSession = () => userManager.removeUser();
/**
 * Sign out, and end up signed out either way.
 *
 * `signoutRedirect` asks the identity provider to end its own session, which is the right
 * thing to do and is also the thing most likely to fail on a session worth ending — a
 * revoked or expired token may have no `id_token_hint` the provider will still accept.
 * Letting that reject would leave the stored session in place, which is the trap this whole
 * change is about: the sign-out button not signing you out.
 *
 * So the local session is dropped whatever happens. The worst case is a provider session
 * outliving the app's, which the next sign-in resolves; the alternative worst case was a
 * user who cannot leave.
 */
export const logout = async () => {
  try {
    await userManager.signoutRedirect();
  } catch {
    await userManager.removeUser();
  }
};
export const getUser = (): Promise<User | null> => userManager.getUser();

/**
 * What to call the person holding this token.
 *
 * Read from the ID token, so it is available before — and regardless of whether — the API
 * agrees to say anything about them. Falls through the claims Zitadel may or may not have
 * been asked for, and gives up rather than inventing a name.
 */
export function displayNameOf(user: User | null): string | undefined {
  const p = user?.profile;
  return p?.name ?? p?.preferred_username ?? p?.email ?? undefined;
}

// The API client lives in lib/api.ts — it consumes getUser() for the bearer token.
