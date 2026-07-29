import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';

/**
 * OIDC Authorization Code + PKCE against the PORTAL Zitadel application.
 *
 * Two things differ from the internal app, and both are deliberate.
 *
 * The client id is the portal application's. That gives the token an audience the API can
 * check — though the audience is only a supporting check there, because Zitadel will
 * issue a token carrying an audience the holder has no grant for. What actually
 * authorises is the `portal_client` role, which is why the roles scope is requested here.
 *
 * The scope asks for roles explicitly rather than relying solely on the project's "assert
 * roles" setting. Either alone usually works; asking for both means a missing role claim
 * is a real authorisation failure rather than a configuration gap that looks like one.
 */
export const userManager = new UserManager({
  authority: import.meta.env.VITE_ZITADEL_ISSUER,
  client_id: import.meta.env.VITE_ZITADEL_CLIENT_ID,
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: 'openid profile email urn:zitadel:iam:org:project:roles',
  automaticSilentRenew: true,
  // sessionStorage, so a token does not outlive the tab. This matters more here than
  // internally: a client's device is not a device we know anything about.
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
});

export const login = () => userManager.signinRedirect();
export const logout = () => userManager.signoutRedirect();
export const getUser = (): Promise<User | null> => userManager.getUser();
