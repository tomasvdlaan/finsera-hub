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
export const getUser = (): Promise<User | null> => userManager.getUser();

/**
 * Sign out at Zitadel, or failing that at least here.
 *
 * The redirect leg needs the post-logout URI registered on the application, and if it is
 * not, `signoutRedirect` throws — leaving someone signed in with no way out, which is the
 * one thing a logout button must never do. Dropping the local session is not a true
 * single sign-out (the Zitadel session survives, so signing in again will not prompt),
 * but it ends the session in this browser, which is what was asked for.
 */
export const logout = async (): Promise<void> => {
  try {
    await userManager.signoutRedirect();
  } catch {
    await userManager.removeUser();
    window.location.replace('/');
  }
};
