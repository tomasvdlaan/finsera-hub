# Phase 8 — Client Portal v2: subdomains, tickets, custom content

**Status:** P1–P5 confirmed 2026-09-03; **steps 1–6 built** (§5). Not yet live: needs the
wildcard DNS record, a working portal application in Zitadel, and the env in runbook §9
**Parent:** [phase7-portal-brief.md](phase7-portal-brief.md) — everything there still governs
**Decisions:** P1–P5 in §3, recorded in the decision log

---

## 1. What is being asked

Three things, in the order they were asked and roughly the reverse order of difficulty:

1. **A subdomain per client** — `dochorse.finsera.nl`, `duce.finsera.nl`, …
2. **Tasks and tickets** — a client sees the work that is being done for them, and can open
   a ticket and follow it, instead of a one-shot request that vanishes into a task.
3. **Custom content** — Finsera builds bespoke HTML reports, mostly hosted on Vercel, and
   wants to serve them at a link on the client's own subdomain, e.g. `duce.finsera.nl/report1`.

The third one is the reason for the first one. A report link that reads
`duce.finsera.nl/report1` is a product; `portal.finsera.nl/clients/3f9a…/pages/report1` is not.

## 2. What exists, and what it means for this

The Phase 7 portal is a **separate SPA (`apps/portal`), not deployed**, talking to
`/api/portal/*` with a Zitadel access token held in `sessionStorage` and sent as a Bearer
header. The API has **no idea what host it was reached on**: no trust-proxy, no CORS, no
cookies, and the Caddyfile has exactly one site block. `crm.clients` has no slug. The
request form is deliberately terminal (`open → converted | declined`), and no task is
marked as visible to a client. Hub and portal already share **one Zitadel project** as two
applications (decision log, 2026-07-29); what is missing is any rule that admits an
employee to a client's portal.

Two of those facts decide the shape of this phase:

- **A Bearer token cannot open `duce.finsera.nl/report1`.** A report link is a plain
  navigation — from an email, a bookmark, a Teams message. The browser sends no
  `Authorization` header on a navigation, and a report's own `<script src>` and `<img src>`
  requests would not carry one either. The only credential a browser attaches to those is
  a **cookie**. So the portal has to move from "token in the SPA" to "session cookie set by
  the API". That is the one change here that touches security architecture; §3 P1.
- **Something has to decide, per request, whether `/report1` is a page or a SPA route.**
  Caddy cannot ask the database. So on the portal hosts the API must own the whole
  origin — serve the SPA bundle itself and fall through to the page table — instead of
  Caddy splitting `/api/*` from static files. §4.3.

Everything else is additive: a slug column, a session table, a ticket thread, a
client-visible flag on tasks, a page table, and a proxy.

## 3. The decisions

### P1 — Sessions become cookies, issued by the API (recommended: yes)

Keep Zitadel as the identity provider (D5, G4 unchanged). Change only *where the session
lives*: the API completes the OIDC code exchange server-side (a "backend for frontend")
and sets an `httpOnly; Secure; SameSite=Lax` cookie scoped to **that one subdomain**. The
access token never reaches the browser.

| | For | Against |
|---|---|---|
| **Cookie session, per subdomain** *(recommended)* | Plain links to reports work. Report assets work. Token never in JS. A `duce` cookie is never sent to `dochorse` or to `hub` | New table `portal.sessions`, a login redirect dance (§4.2), CSRF care on the few `POST`s |
| **Keep Bearer, render reports in a sandboxed iframe via `srcdoc`** | No auth change | Every asset in the report needs a credential the iframe cannot send; fails the first time a report has a `<script src>`. Ruled out |
| **Cookie with `Domain=.finsera.nl`** | One login for all subdomains | Cookie is also sent to `www` (Vercel) and `hub` (internal). One cookie spanning clients is precisely the session-spans-clients shape the `portal.users` design refuses. Ruled out |

**Why this is not the weakening it looks like.** The three-gate model from Phase 7
survives intact: the API still verifies Zitadel's token (now once, at login), still checks
the `portal_client` role, still resolves `sub → portal.users → client_id`. What changes is
that the *result* of those checks is stored server-side and referenced by an opaque
cookie, instead of re-verified on every request from a token the browser holds. A session
row can be revoked instantly (`disabled_at` on the user already cascades to that); a
Bearer token could not be.

### P2 — One login callback, not one per subdomain (recommended: yes)

Zitadel redirect URIs are exact-match. Registering `https://<slug>.finsera.nl/auth/callback`
for every client is a manual Zitadel step per onboarding and a thing that silently breaks
when someone forgets it. Instead:

```
duce.finsera.nl/api/portal-auth/login
  → portal.finsera.nl/api/portal-auth/start        signed login state → cookie on the auth host
  → 302 Zitadel (redirect_uri = https://portal.finsera.nl/api/portal-auth/callback)
  → portal.finsera.nl/api/portal-auth/callback     API exchanges code, runs the three gates,
                                                   mints a one-time 60 s handoff ticket
  → 302 duce.finsera.nl/api/portal-auth/complete?t=…
                                                   API redeems ticket, creates the session and
                                                   sets the cookie on duce, 302 to the page asked for
```

*(As built: the routes live under the API's `/api` prefix rather than a bare `/auth`, and
the session row is created on the host that sets the cookie, not at the callback — so a
ticket carries an identity, never a session.)*

One redirect URI in Zitadel, forever. The state is HMAC-signed with a server secret so a
callback cannot be pointed at a host the flow did not start on, and the handoff ticket is
single-use and bound to the target host. `portal.finsera.nl` itself hosts nothing but this
callback and a "which client are you?" page for someone who lands there by hand.

**Why not skip the hop and set the cookie from the callback:** the callback runs on
`portal.finsera.nl`; it cannot set a cookie for `duce.finsera.nl`. The hop is the cost of
P1's per-subdomain scoping, and it is one redirect.

### P3 — Proxy reports server-side, do not iframe or redirect (recommended: proxy)

| | For | Against |
|---|---|---|
| **Reverse-proxy from the API** *(recommended)* | Vercel URL never visible; Vercel project can stay fully protected; access control is ours; report is *at* `duce.finsera.nl/report1` | Path rewriting for root-absolute asset URLs (§4.4); we carry the bytes |
| **Redirect to the Vercel URL** | Trivial | The link leaks the origin; anyone with it has the report. This is the status quo the ask is trying to leave |
| **iframe the Vercel URL** | No proxying | Same leak (the URL is in the DOM), plus Vercel's own frame headers and ours (`X-Frame-Options DENY`) fight it |

**Access to the Vercel deployment** uses Vercel's *Protection Bypass for Automation*: the
project keeps Deployment Protection on, and the API sends `x-vercel-protection-bypass:
<secret>` on every proxied request. The secret is stored encrypted per page (or per
client), never in the URL. Reports that are on Vercel today with no protection continue
to work with no secret; protecting them becomes a checkbox in Vercel once the proxy is
live.

### P5 — Same Zitadel project; employees may enter every portal, clients only their own (recommended: yes)

**Where things stand.** Hub and portal already share one Zitadel project (decision log,
2026-07-29 revision: "one project is sufficient"). They are two *applications* in it, with
two client ids, and that stays: under P1 the portal application becomes a confidential web
app with a client secret, while hub remains a public SPA with PKCE. One project, one user
directory, one login screen. What does not exist yet is a rule that lets an employee's
login through on a client's subdomain.

**The rule.** At the login callback, after the token is verified, the subject is resolved
in this order:

1. **`core.users`** (an active member with this OIDC subject) → a **staff session**. Valid
   on *any* client host. This is a row we wrote when the employee was provisioned, so it
   is the same kind of evidence as a `portal.users` row, and it works today even though
   Zitadel emits no role claims (G6). When role grants start working, the `internal` role
   becomes a second, required gate, in the style of the existing three-gate model.
2. **`portal.users`** (this subject, not disabled) → a **client session**, valid only on the
   host whose slug belongs to that row's `client_id`. Any other host: 403.
3. Neither → 403. First-sign-in email claiming (`claimByEmail`) applies to step 2 only, and
   refuses an email that already belongs to a `core.users` member, so one person is never
   both.

**What a staff session can do in a portal.** Everything a client can *read*, including
pages — this is the "see what the client sees" that `portal-preview` approximates today,
and it replaces it. It cannot perform client actions: accepting a quote or opening a
ticket as the client is refused, because those are statements *by* the client. Replying
to a ticket from the portal is allowed and is recorded as an internal author. The portal
shows a persistent "Finsera — bekijkt als medewerker" bar so nobody mistakes the view.

**Audit.** Client reads keep `actorId: null` with the portal user id, as today. Staff
reads are audited with the employee's `core.users` id, so "who looked at duce's report"
has an answer either way.

**Why the host still never chooses the client for a client session.** For a staff session
the host *does* pick the client — that is fine, because staff can already see every client
internally, so there is nothing to leak. For a client session the `client_id` comes from
the `portal.users` row and the host can only agree or be refused. Two session kinds, one
column (`portal.sessions.kind ∈ client | staff`), and the guard branches on it exactly
once.

### P4 — Wildcard DNS plus on-demand TLS, no wildcard certificate (recommended: yes)

`*.finsera.nl` gets one `A` and one `AAAA` record at ZXCS pointing at the Netcup box.
Existing explicit records (`hub`, `www`, apex, MX) are unaffected — a wildcard only
answers for names that have no record of their own. Caddy then issues a certificate **per
subdomain, on first request**, via HTTP-01, exactly as it does for `hub` today. Before
issuing, Caddy asks the API whether the host is a known client slug; unknown hosts get
nothing, so a typo cannot burn a certificate. No DNS-01, no ZXCS plugin, no wildcard cert
to renew.

Rate-limit arithmetic: Let's Encrypt allows 50 certificates per registered domain per
week. At Finsera's client count that limit is not reachable by accident, and the `ask`
endpoint makes it unreachable on purpose.

## 4. Design

### 4.1 Data

**`crm.clients`** — one new column, `portal_slug text UNIQUE NULL`. Lowercase
`[a-z0-9-]{2,40}`, checked in the DB; a reserved list (`hub`, `www`, `portal`, `api`,
`mail`, `admin`, …) enforced in the service. Null means no portal host; the Phase 7 admin
"invite user" action refuses until a slug is set, so a client cannot have users and no
address. The slug is the *only* thing derived from the Host header, and it is used for
one purpose: after the session has already named a `client_id`, assert that the host's
slug belongs to that client, or 403. The host never *chooses* the client; it can only
disagree with the session and lose.

**`portal.sessions`** — `id` (random 256-bit, the cookie value is its hash),
`kind ∈ client | staff`, `portal_user_id` (client sessions), `staff_user_id` (staff
sessions; a `core.users` id), a check that exactly one of the two is set, `client_id`
(denormalised on purpose, so revocation and the host assertion are one row read; for a
staff session it is the host's client), `created_at`, `last_seen_at`, `expires_at` (30 days sliding, 12 h absolute idle),
`revoked_at`, `ip`, `user_agent`. **`portal.handoff_tickets`** — `id`, `session_id`,
`target_host`, `expires_at`, `redeemed_at`; rows are deleted on redeem and swept hourly.

**`portal.tickets`** and **`portal.ticket_messages`** replace `portal.requests`:

```
tickets:   id, client_id, portal_user_id (opener), subject ≤200, status, project_id?,
           task_id?, assigned_to? (core.users), last_client_message_at,
           last_internal_message_at, closed_at, created_at
messages:  id, ticket_id, author_kind ('client' | 'internal'), author_id
           (portal.users id or core.users id, per kind), body ≤5000,
           internal_only boolean (an internal note the client never sees), created_at
```

`status ∈ open | waiting_on_finsera | waiting_on_client | closed`. Status is derived
mechanically on every message (client writes → `waiting_on_finsera`; internal non-note
writes → `waiting_on_client`) and only `closed` is set by hand, so it never lies. The
schema comment on `portal.requests` about client-authored text still applies word for
word: a ticket is displayed as *client-submitted*, becoming a task stays a deliberate
click, and `ticket_messages` is **not** in any assistant tool's read set. Migration: every
existing request becomes a ticket with one message; `converted` → `closed` with
`task_id` kept, `declined` → `closed`.

**`scrum.tasks`** — one new column, `client_visible boolean NOT NULL DEFAULT false`, and
`scrum.manifest.ts` declares a `task` exposure of exactly `id, project_id, title, status,
type, due_on, completed_at`. Not description (internal notes end up there), not assignee,
not estimate, not labels, not blocked reason. `assertExposed` will refuse anything else,
which is the point of it. The internal task detail gets a "Visible to client" toggle; a
new task defaults to hidden.

**`portal.pages`**:

```
id, client_id, slug (unique per client, same charset as portal_slug, reserved list =
the SPA's routes), title, kind ('proxy' | 'redirect'), source_url (https only),
bypass_secret_enc (nullable, encrypted at rest with a server key), enabled boolean,
created_by, created_at, updated_at
```

`kind = 'redirect'` exists for content that genuinely must live elsewhere; it is the
lossy option and the admin UI says so.

### 4.2 Auth flow and hosts

```
GET https://duce.finsera.nl/…            any path, no cookie
  API: host → slug 'duce' → client. No session → 302 /auth/login?next=/…
GET /auth/login                          302 Zitadel with signed state {host:'duce', next, nonce}
GET https://portal.finsera.nl/auth/callback?code&state
  API: verify state signature; exchange code (client secret lives in the API, not the SPA);
  verify id/access token — issuer, audience = ZITADEL_PORTAL_CLIENT_ID, portal_client role
  (subject to the same PORTAL_ROLE_CHECK opt-out as today, G6 unchanged);
  resolve sub → core.users (staff) else portal.users (client; first sign-in: claimByEmail
  as today, refusing an email that is a member) — P5;
  client session: assert user.client.portal_slug == state.host, else 403 "not your portal";
  staff session: client_id = the host's client;
  insert portal.sessions; insert handoff ticket bound to 'duce.finsera.nl';
  302 https://duce.finsera.nl/auth/complete?t=…
GET /auth/complete?t=…                   redeem (single-use, host must match); Set-Cookie
                                         psid=…; HttpOnly; Secure; SameSite=Lax; Path=/;
                                         302 next
```

Logout deletes the session row and clears the cookie; a Zitadel end-session redirect is
optional and off by default (a client with SSO should not be logged out of their own IdP
by us). The internal app on `hub` is untouched: it keeps Bearer tokens, and the portal
guard still refuses to set `req.actor`.

**CSRF.** `SameSite=Lax` blocks cross-site `POST`s in every current browser; the API
additionally requires a `X-Requested-With` header on state-changing portal routes, which
a cross-origin form cannot add. The three `POST`s today (accept quote, open ticket,
reply) are all JSON from the SPA.

**Trust proxy.** Caddy is the only thing that reaches the API, so `Host` and
`X-Forwarded-Proto` from it are trusted; the API resolves the host from the `Host` header
only, never `X-Forwarded-Host`, and refuses any host that is neither `portal.finsera.nl`
nor a known slug with a 404 that carries no hint the platform exists.

### 4.3 Routing on a portal host

Caddy gets a second site block:

```
*.finsera.nl, portal.finsera.nl {
    tls { on_demand }                       # ask → http://api:3001/api/portal-host/check?domain=
    reverse_proxy api:3001                  # everything; the API owns the origin
    header { X-Content-Type-Options nosniff; Referrer-Policy strict-origin-when-cross-origin }
}
```

The API, for a portal host, resolves in this order:

1. `/api/portal/*` and `/auth/*` — controllers, as today.
2. A path whose first segment is an enabled `portal.pages.slug` for this client — proxy (§4.4).
3. Anything else — the `apps/portal` SPA bundle with history fallback, served by
   `@nestjs/serve-static` from a directory the API image now builds.

`Dockerfile.api` grows a stage that builds `apps/portal` and copies `dist/` in; `apps/web`
stays with Caddy on `hub` exactly as now. `X-Frame-Options DENY` moves from Caddy to the
API for SPA responses only, so a proxied report can decide its own framing.

### 4.4 The proxy

`GET /report1` → 302 `/report1/` (so relative URLs in the report resolve inside it).
`GET /report1/<rest>` → `fetch(source_url + '/' + rest)` with the bypass header, a 10 s
timeout, a 20 MB cap, hop-by-hop and `set-cookie` headers dropped, `content-type`,
`content-length`, `cache-control` and `etag` passed through, `cache-control` forced to
`private` on HTML. Streams; never buffers non-HTML.

**Root-absolute URLs are the one real problem.** A Vite build emits `/assets/index-abc.js`;
a Next build emits `/_next/static/…`. Inside `duce.finsera.nl/report1/` those resolve to
the SPA, not the report. Two mitigations, both:

- **Preferred:** reports are built with a relative base (`base: './'` in Vite, `assetPrefix`
  in Next). Finsera builds these reports, so this is a build-config line, and the admin
  page for a proxy page says so.
- **Fallback:** for `text/html` and `text/css` responses only, the proxy rewrites
  `src="/…"`, `href="/…"`, `url(/…)` and `<base href>` to `/report1/…`, skipping `//` and
  `/report1/` itself. Regex on a decoded body, bounded by the size cap. It will not catch
  a URL assembled in JavaScript, and it does not try to.

Not proxied: `POST`, websockets, ranges. A report is a page, not an app; if one grows into
an app it gets its own subdomain, not a slug.

**Audit.** Each page open writes a `portal.read` audit row (`entity: page`), as every
portal read does today. Asset requests under the same page do not.

### 4.5 Portal UI

- Nav becomes: Overzicht · Projecten · Taken · Tickets · Offertes · Facturen ·
  Documenten · **Rapporten** (the page list — title, opened-at, one click). A client with
  no pages does not see the last tab.
- **Taken** — per project, the visible tasks grouped by board column, read-only. Nothing
  is editable from the portal in this phase.
- **Tickets** — list with status chips, thread view, reply box, "open a ticket" form with
  optional project. Client sees `internal_only = false` messages only.
- Login page is replaced by a redirect; the SPA never holds a token. `api.ts` drops the
  Authorization header and adds `credentials: 'same-origin'` and `X-Requested-With`.

### 4.6 Internal UI (`apps/web`)

- Client detail: **Portal slug** field with a live "duce.finsera.nl" preview and the
  reserved-name check; the invite button is disabled until a slug exists.
- Client detail: **Pages** panel — add/edit/disable, kind, source URL, bypass secret
  (write-only, shows "set"), a "Test" button that performs one proxied `HEAD` and reports
  the status, and the resulting link to copy.
- `/portal/requests` becomes `/portal/tickets`: an inbox across clients, thread view,
  reply (public or internal note), assign, close, "make a task" (unchanged semantics:
  deliberate, links `task_id`, does not close the ticket).
- Task detail: "Visible to client" toggle, with the exposed field list shown next to it
  so nobody has to guess what the client will see.

### 4.7 Ops

- **DNS:** `*.finsera.nl A` + `AAAA` → Netcup, at ZXCS. `hub`, apex, `www`, MX untouched.
- **Zitadel:** same project as hub, no new project. On the existing portal application:
  one new redirect URI `https://portal.finsera.nl/auth/callback`, and change its type
  from PKCE-public to confidential (client secret in `deploy/.env` as
  `ZITADEL_PORTAL_CLIENT_SECRET`). Post-logout URI optional. Employees need no extra
  Zitadel setup: their `core.users` row is what admits them (P5).
- **Env:** `PORTAL_BASE_DOMAIN=finsera.nl`, `PORTAL_AUTH_HOST=portal.finsera.nl`,
  `PORTAL_SESSION_SECRET` (state HMAC), `PORTAL_PAGE_KEY` (bypass-secret encryption).
  All fail closed at boot when missing in production, in the style of the existing
  audience check.
- **Caddy:** second site block above; `caddy_data` volume already persists certificates.
- **Runbook:** the "portal not deployed" gap in `deploy-runbook.md` §Known gaps closes;
  a new section documents onboarding a client: set slug → invite user → (optionally) add
  pages.

## 5. Build order and gates

| Step | Delivers | Verifiable by |
|---|---|---|
| 1 ✅ | Slug column, host resolver, `portal.sessions` + handoff tickets, BFF login with the auth host serving the portal, SPA served by the API, Caddy block, Dockerfile. Existing Phase 7 features work through the cookie. Built 2026-09-03; the handoff and host assertion are in, so step 2 is DNS, Caddy's `*.finsera.nl` line with `ask`, and staff sessions | A real login on `portal.finsera.nl` (needs the DNS record and the Zitadel redirect URI — runbook §9); `hub` unaffected |
| 2 ✅ | Wildcard Caddy block with on-demand TLS and the `ask` endpoint (`/api/portal-host/check`); host/session assertion; staff sessions with the staff bar and staff audit; 404 for unknown hosts. Built 2026-09-03. Needs the wildcard DNS record to go live | Client login on `duce.finsera.nl`, refused on `dochorse`; Tomas's login accepted on both, refused on quote-accept |
| 3 ✅ | `portal.pages` + proxy + rewriting + admin panel + Rapporten tab. Built 2026-09-03 | A real Vercel report opens at `duce.finsera.nl/<slug>/` with Deployment Protection on |
| 4 ✅ | Tickets (schema, data migration out of `portal.requests`, both UIs). Built 2026-09-03 | Round trip: client opens, Tomas replies, client sees it, close |
| 5 ✅ | `client_visible` on tasks, `task` exposure, Taken tab, toggle. Built 2026-09-03 | A hidden task is absent from `/api/portal/tasks`; the projection now refuses undeclared fields outright |
| 6 ✅ | Security review — §6 below. Built 2026-09-03 | Ten findings, each closed or dated |

**Gate G7:** steps 1–3 live with one real client on their own subdomain and one real
report behind protection. Tickets and tasks (4–5) are useful but not what makes this phase
worth doing; they can trail.

## 6. The security review (step 6)

An adversarial pass over everything above, in the style of Phase 7 §5f: not a re-run of the
unit tests, but an attempt to reach another client's data, to reach the internal platform
from outside, and to act *as* a client while merely looking at their portal.

**Ten findings. All ten are closed**, and the fixes are described where they live. In
severity order:

| # | What | Closed by |
|---|---|---|
| 1 | **Path traversal in the proxy.** Express does not normalise the request line and `encodeURIComponent('..')` is `..`, so `/rapport/../../elders/` reached `fetch`, which collapsed it — an arbitrary path on the source origin **with the bypass secret attached**. Where several clients' reports share one Vercel project, a cross-client read | Segments equal to `.` or `..` are refused, and `underSource()` re-checks that the built URL is still inside the page's own path — the same rule `sameOriginPath()` already applied to upstream redirects, now stated in both directions |
| 2 | **The host cache was never invalidated.** `forget()` had no production callers, so clearing a slug or archiving a client left the portal live for up to 30 s, and reassigning a slug sent its new owner to a 403 at their own address | The cache is gone. One indexed lookup of one row costs less than CRM reaching into another module to invalidate it |
| 3 | **The login host had no client checks at all.** It resolves without consulting `crm.clients`, so a session held there outlived the client being archived or their address being cleared | A client signing in there is now handed off to their own portal, and the guard refuses any host that is not a client's. There is no session on the login host to make safe |
| 4 | **A proxied report could act as the client.** Same origin, `HttpOnly` stops a script *reading* the cookie and not *using* it — so a compromised deployment could `POST /api/portal/quotes/:id/accept` | A `Content-Security-Policy` with `connect-src 'none'` and `form-action 'none'` on every proxied response |
| 5 | **`PORTAL_PAGE_KEY` never reached the container.** The compose file enumerates its environment explicitly, so a bypass secret could never be stored — and the workaround is turning Vercel's protection off, which is the problem P3 exists to end | Added to `deploy/docker-compose.yml` and both `.env.example` files |
| 6 | **SSRF: a comment claimed more than the code did.** The address check refused private ranges but not our own hostnames, and runs at save time only | Our own domains are refused too. The save-time-only limit is now stated where it is true, including for the "Test" button |
| 7 | **Existence oracles.** The certificate-ask endpoint was public, so anyone could enumerate which client slugs exist | Gated on `PORTAL_ASK_TOKEN`, carried in the ask URL because Caddy sends no custom headers. The proxy's own "page exists" signal is left, and stated: it tells a stranger no more than opening the hostname would |
| 8 | **`portalExposure` field lists were decorative.** `assertExposed` checked only that *some* field was declared, so narrowing a manifest changed nothing | `assertFields()` compares the returned columns against the declaration, with derived columns named at the call site |
| 9 | **Session fixation via `/complete`.** A ticket URL opened by somebody else planted the opener's session in their browser | The ticket is bound to a nonce cookie set on the host where the login began; a login that began on the login host is unbound and says so |
| 10 | Smaller: a protocol-relative redirect from `//slug`; `trust proxy: true`; the ticket rate limit scoped per login rather than per client; no `nosniff` on portal file responses; the client's words pasted into a task with only a prose prefix; `portalSlug` silently dropped by `createClient` | All fixed. The task description now fences the client's text and says it is a quotation, because that string ends up where the assistant reads it |

**What was tried and held.** `X-Forwarded-Host` is read nowhere; a port suffix, trailing
dot, uppercase, non-ASCII and a nested label all fail closed; `hub` is refused three
independent ways. Handoff tickets are single-use by `DELETE … RETURNING`, host-bound, and
sixty seconds long; `safeNext` is applied at every hop. Sessions re-read the user row on
every request, so revoking a login or deactivating a colleague ends them immediately. The
bypass secret and the source URL never appear in a proxied response — the header
allow-list is four names, so `set-cookie` is dropped by omission rather than by a line
somebody could delete. A client cannot set a ticket's status or point one at another
client's project, and `internal_only` is filtered on both queries a client can reach. The
assistant cannot publish a task: `clientVisible` is absent from the tool schema and from
its input type. And a portal request never sets `req.actor`, so it cannot satisfy an
internal guard even though Caddy proxies `/api/*` from portal hosts to the same process.

**Left open, deliberately.** DNS rebinding against a stored page source: closing it needs a
pinned-address fetch that Node's `fetch` does not offer, and the caller already holds
`portal.admin`. The 20 MB buffer for HTML and CSS is per concurrent request. And a page's
existence is observable to a signed-out visitor, which is what opening the hostname would
tell them anyway.

## 7. Out of scope, on purpose

- Editing tasks from the portal, or a client-side Kanban.
- Uploading content into the portal. Content lives on Vercel (or any https origin); the
  portal is a door, not a shelf.
- Custom domains per client (`reports.duce.nl`). Same mechanism, but needs the client's
  DNS and a CNAME flow; not until a client asks.
- Per-page access within a client (only some users see `report1`). All users of a client
  see all of that client's pages; the `portal.users` model has no groups and this phase
  does not add them.
- A portal assistant (still deferred from Phase 7 §3).
