/**
 * Signing in and out — both of which happen on the server now (Phase 8, P1).
 *
 * Phase 7 ran the OIDC flow in this bundle with `oidc-client-ts` and kept the access token
 * in `sessionStorage`. That cannot open a report link from an email: a plain navigation
 * carries no Authorization header, and neither do the report's own scripts and images. So
 * the API does the exchange, sets an HttpOnly cookie, and this file is two redirects.
 *
 * Nothing here knows the issuer or the client id. That is the point: the bundle a client's
 * browser downloads contains nothing about how authentication works.
 */

/** Go and sign in; come back to `next` (defaults to wherever we are). */
export function login(next: string = window.location.pathname + window.location.search): void {
  const url = new URL('/api/portal-auth/login', window.location.origin);
  url.searchParams.set('next', next);
  window.location.assign(url.toString());
}

/**
 * Sign out here **and** at the identity provider.
 *
 * Ending only our own session was the obvious reading of "log out" and the wrong one: the
 * provider's session survived, so the next press of Inloggen signed the same person
 * straight back in without asking. On a shared machine that is a logout button that does
 * not log anybody out, and for anyone with two accounts it is a door that only opens one way.
 *
 * Two steps, in this order. The POST ends our session — it carries the header the API
 * requires on a write, which a plain navigation could not — and answers with where to go
 * next. Then the browser navigates there, because ending the provider's session is a
 * redirect and not something `fetch` can do. If the provider offers no such endpoint, or
 * anything at all goes wrong, we still land on the signed-out screen with our own session
 * gone.
 */
export async function logout(): Promise<void> {
  let next = '/';
  try {
    const res = await fetch('/api/portal-auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'portal' },
    });
    if (res.ok) {
      const body = (await res.json()) as { endSession?: string | null };
      if (body.endSession) next = body.endSession;
    }
  } finally {
    window.location.replace(next);
  }
}
