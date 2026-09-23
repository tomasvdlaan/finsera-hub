/**
 * What we send to the origin a report is hosted on, and to nobody else.
 *
 * Two credentials, with different owners and different scopes, both of which would be
 * damaging to hand to the wrong host — so the rule for each lives here rather than being
 * repeated at the two places that fetch (the proxy, and the admin screen's *Test*).
 *
 * `x-vercel-protection-bypass` is the page's own secret: an admin typed it for *this*
 * source URL, so it goes wherever that page points.
 *
 * `x-proxy-secret` is different in kind. It is one value for the whole Vercel account,
 * configured so that a project can refuse anything not coming through us — which means
 * possessing it is enough to reach every report we host. It therefore goes **only** to
 * `*.vercel.app`, the hosts it was issued for. A page's source URL is typed by a person and
 * can be any origin: a client's own site, another vendor, a link somebody pasted wrong.
 * Sending an account-wide credential to whatever that host turns out to be is how a secret
 * ends up in somebody else's access log.
 */

/** The account-wide secret, or null when this deployment has not been given one. */
function proxySecret(): string | null {
  const value = process.env.VERCEL_PROXY_SECRET?.trim();
  return value ? value : null;
}

/**
 * Is this address one of Vercel's own?
 *
 * `endsWith('.vercel.app')` on the parsed hostname, never on the raw string: `URL` lowercases
 * the host and strips userinfo, so `https://vercel.app@evil.example/` — which reads as Vercel
 * to a careless check — parses as `evil.example` and is refused. The bare apex is included
 * because a project can be reached at it, and `evilvercel.app` is not: the leading dot is
 * what makes this a suffix match on a label boundary rather than on characters.
 */
export function isVercelHost(target: string): boolean {
  try {
    const { hostname } = new URL(target);
    return hostname === 'vercel.app' || hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

/**
 * The credential headers for one upstream request.
 *
 * Returns a plain object so a caller can spread it beside the headers it already sets, and
 * so an absent credential is an absent key rather than an empty string — a header with no
 * value is not the same as no header, and Vercel treats it as a failed match.
 */
export function upstreamCredentials(
  target: string,
  bypassSecret: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret;
  const secret = proxySecret();
  if (secret && isVercelHost(target)) headers['x-proxy-secret'] = secret;
  return headers;
}
