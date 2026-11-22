# Connecting an artefact to the Hub

How a deployment on Vercel (a *proxy page*, in `portal.pages`) is served by the Hub and how it
learns who is looking. Code: `apps/api/src/modules/portal/portal-proxy.ts`,
`identity-token.ts`, `identity-jwks.controller.ts`.

## What the Hub does

- Serves the deployment at `https://<client>.<PORTAL_BASE_DOMAIN>/<slug>/` by fetching it
  server-side. The Vercel URL never reaches the browser.
- Requires a portal session for that client, and per-person visibility if set.
- Sends two credentials upstream (`vercel-headers.ts`): the page's own
  `x-vercel-protection-bypass` secret, so Vercel Deployment Protection can stay on, and the
  account-wide `x-proxy-secret` (`VERCEL_PROXY_SECRET`), sent to `*.vercel.app` only. An
  artefact that wants to refuse anything not routed through the Hub checks the latter.
- Sends `x-finsera-identity`, a signed token, on every upstream request.
- Forwards the Next.js App Router request headers and the matching response headers (below).
- Audits every page open (root only) and every write (any depth): path, method, who, and the
  `Next-Action` id. Never a body, never a query string.

## Identity token

| | |
|---|---|
| Header | `x-finsera-identity` |
| Algorithm | EdDSA (Ed25519), `kid` = JWK thumbprint |
| `iss` | `https://hub.finsera.nl` (override with `PORTAL_IDENTITY_ISSUER`) |
| `aud` | the page slug |
| `sub` | portal user id (`kind: client`) or staff user id (`kind: staff`) |
| `email`, `name`, `kind` | as named; `name` falls back to the email |
| `iat`, `exp` | 60 seconds apart; a new token per request |
| JWKS | `https://hub.finsera.nl/api/portal-identity/jwks.json` (cached 5 min) |

Production key: `PORTAL_IDENTITY_KEY` in `deploy/.env` —
`openssl genpkey -algorithm ed25519 | base64 | tr -d '\n'`. Unset means no header and a 404 on
the JWKS URL. A key that is set but unusable makes the proxy answer 503 rather than serve a page
nobody was told the identity of.

### Verifying in Next.js 16

```ts
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose';
import { headers } from 'next/headers';

const jwks = process.env.HUB_JWKS_JSON
  ? createLocalJWKSet(JSON.parse(process.env.HUB_JWKS_JSON))
  : createRemoteJWKSet(new URL(process.env.HUB_JWKS_URL!));

export async function currentUser() {
  const token = (await headers()).get('x-finsera-identity');
  if (!token) throw new Error('Not signed in');
  const { payload } = await jwtVerify(token, jwks, {
    issuer: process.env.HUB_ISSUER ?? 'https://hub.finsera.nl',
    audience: 'vertragingsmeldingen',
    algorithms: ['EdDSA'],
    clockTolerance: 5,
  });
  return { id: payload.sub!, email: String(payload.email ?? ''), name: String(payload.name ?? ''), kind: payload.kind as 'client' | 'staff' };
}
```

Call it in every server action and route handler, not only in the page: the token is per request.

### Testing without the Hub

```bash
cd apps/api
node scripts/identity-test-kit.mjs keygen          # ./.identity-test/ (gitignored): key + jwks.json
node scripts/identity-test-kit.mjs serve           # http://localhost:4010/jwks.json  (HUB_JWKS_URL)
node scripts/identity-test-kit.mjs mint --aud vertragingsmeldingen --email a@b.nl --name "A B"
curl -H "x-finsera-identity: $(node scripts/identity-test-kit.mjs mint)" http://localhost:3000/vertragingsmeldingen/
```

`keygen` also prints the JWKS on one line for `HUB_JWKS_JSON`, which is what a Vercel preview
should use (a preview cannot reach your localhost). `mint` defaults to a one-hour token, so a
test token outlives the 60 seconds production ones have. Keep `HUB_JWKS_JSON` out of production.

## Next.js requirements

- `basePath: '/<slug>'` and `trailingSlash: true` in `next.config`. Register the page with a
  source URL that ends in that path: `https://<project>.vercel.app/<slug>`. Without
  `trailingSlash`, Next redirects `/<slug>/` to `/<slug>`, which the Hub redirects back: a loop.
- Server actions only work through `fetch`. The CSP has `form-action 'none'`, so a form that
  posts before hydration is blocked.
- Own data requests must go to a path under the slug (`connect-src <host>/<slug>/`).
- Do not rely on cookies from the app; `Set-Cookie` from upstream is dropped.

## Headers passed through

Request (browser → app): `Next-Action`, `Next-Router-State-Tree`, `Next-Router-Prefetch`,
`Next-Router-Segment-Prefetch`, `Next-Url`, `RSC`. Everything else a browser sends is dropped.

Response (app → browser): `x-action-revalidated`, `x-nextjs-rewritten-path`,
`x-nextjs-postponed`, `Vary`, and `x-action-redirect` — the last only when it stays on the
app's own origin, mapped from the source's base path back to the slug.

## CSP the Hub adds (always; the app's own CSP is never forwarded)

```
default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:;
font-src 'self' data: https://fonts.gstatic.com; connect-src <host>/<slug>/;
form-action 'none'; base-uri 'none'; object-src 'none'
```

## Timeout

Per page, 5–60 seconds, default 10 (`timeout_ms`, "Time-out" on the Custom content form).
