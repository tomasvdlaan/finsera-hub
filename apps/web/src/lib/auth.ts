import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';

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
  scope: 'openid profile email',
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
});

export const login = () => userManager.signinRedirect();
export const logout = () => userManager.signoutRedirect();
export const getUser = (): Promise<User | null> => userManager.getUser();

/** Fetch wrapper that attaches the bearer token. All API calls go through this. */
export async function api<T>(path: string): Promise<T> {
  const user = await getUser();
  const res = await fetch(`/api${path}`, {
    headers: user?.access_token ? { Authorization: `Bearer ${user.access_token}` } : {},
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
