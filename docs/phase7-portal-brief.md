# Phase 7 — Client Portal

**Status:** steps 1–3 built; untested against a real client login (no invited user yet)
**Parent:** [build-roadmap.md](build-roadmap.md) §Phase 7

---

## 1. Why this one is different

Everything built so far has exactly one user, and a permission bug means Tomas sees
something in the wrong order. Here a permission bug means **a client sees another
client's data**. That is not a worse version of the same problem; it is a different
problem, and it is why the roadmap put this last.

So the governing rule for this phase, from which everything else follows:

> **Portal data is not internal data with a filter over it. It is a separate,
> explicitly-built projection, and the internal data is architecturally unreachable.**

A filter is one forgotten `WHERE` clause away from a leak. A separate projection cannot
leak what it never had.

## 2. What a client would actually get

Small, and useful because it is small:

- **Their projects** — status, what is happening, nothing about margin or internal notes
- **Documents shared with them** — explicitly shared, never "all documents for this client"
- **Quotes** — read, and accept. This is the one that pays for the phase: click-to-accept
  is what G3's predecessor deferred out of 5a, and the portal is where it belongs
- **Invoices** — what is owed and what is paid, with the PDF
- **A request form** — becomes an internal task, so "can you also…" stops living in email

Explicitly not: hours, rates, margin, internal meeting notes, the pipeline, anything about
other clients, and anything about the business.

## 3. The decisions

### G4 — how a client signs in

Zitadel is already fixed (D5). The original plan was a **separate tenant** so a portal
account could never be an internal one; §5b explains why the separation ended up resting
on project roles instead, which works within a single project. What was open is the method:

| | For | Against |
|---|---|---|
| **Magic link** *(recommended)* | Nothing to remember, nothing to reset, no password to leak. A finance person logging in twice a year will never remember a password | Email becomes the security boundary; a forwarded link is an account |
| **Password** | Familiar; works when email is slow | Password reset flows, storage, and the reset flow is itself an attack surface |
| **SSO into their own tenant** | Best security, no new credential | Only works for clients with an IdP, and needs setup per client — for one client, weeks of work for one login |

**Decided:** none of them, in the sense that we do not build any. All three are Zitadel
features, so the method is a **configuration choice in Zitadel**, not code here. What this
codebase does is verify the token, require the `portal_client` role, and look up which
client it belongs to. Starting with a password and passwordless link enabled costs
nothing extra, and adding SSO for a client who has an IdP is later a Zitadel setup task
rather than a change to anything built.

That is why there is no magic-link table, no reset flow and no rate limiter of our own in
step 1: each would be a second implementation of something the identity provider already
does, and the second implementation is the one that gets the security bug.

### Portal exposure is per-entity and opt-in

Every module manifest already has a `portalExposure` field, empty everywhere. It stays
empty unless a module deliberately declares an entity visible, and the portal reads only
what is declared. Nothing is portal-visible by default, and adding a module cannot
accidentally expose anything.

### The portal assistant, if any

The roadmap wants one. It would need a tool set built from `portalExposure` alone —
architecturally unable to reach an internal tool, not merely filtered from calling it.

**Recommended: not in the first cut.** The portal is worth having without it, and the
assistant is the part where a mistake is worst. Ship the portal, watch it, then decide.

That also defers O8 (client DPA language for AI processing) rather than forcing it now.

## 4. What must be true before a client sees it

- **A security review**, on the portal specifically. Not a general code review: an
  attempt to reach another client's data through every endpoint the portal exposes.
- **Tests that assert the negative** — a portal user requesting another client's invoice
  gets nothing, and the test fails loudly if that ever changes.
- **Rate limiting** — on Zitadel's side, since the login endpoint is theirs, not ours. Ours
  is worth adding on the portal API once endpoints exist.
- **The audit log covering portal reads**, not just writes. Who saw what matters more
  externally than internally.

## 5. Build order

| Step | Deliverable |
|---|---|
| 1 | ✅ Portal projection layer + `portalExposure` enforcement, with negative tests |
| 2 | ✅ Token verification, role separation, invite/revoke |
| 3 | ✅ Read-only portal: projects, quotes, invoices, documents |
| 4 | Quote acceptance — the part that earns its keep |
| 5 | Request form → internal task |
| 6 | Security review before a single external user |

## 5a. What step 1 built

`portal.users` (one table: which login is which client, as a column rather than a token
claim), `PortalProjection` (every query names its columns and binds `visitor.clientId`),
and `PortalModule`, which imports no module — so a portal request never holds a reference
to `BillingService`, and "remember to pass the right filter" is not a thing anyone can
forget.

`PortalVisitor` is deliberately not an `Actor`. Serving internal data from a portal
endpoint would require passing the wrong type, which is a compile error rather than a
review comment.

**The exposure surface, in full** — five entity types, no hours, no rates, no margin, no
contracts, no clients:

| Module | Entity | Notable omissions |
|---|---|---|
| crm | `project` | no `default_rate_cents`, no `budget_amount_cents` |
| billing | `invoice` | drafts excluded by row predicate, not by field list |
| sales | `quote`, `quote_line` | drafts excluded; contracts not exposed at all |
| docs | `document` | requires a `shared_with_client` link, not a matching `client_id` |

That last row is the one worth restating: **filed against a client is not shown to the
client**. A document filed under a client is often filed for our benefit — an internal
analysis, notes on a negotiation. Sharing is a deliberate act, recorded as a link.

### The tests, and why they are believable

14 tests, and the ones that matter assert a negative. Green tests prove nothing on their
own, so each guarantee was verified by breaking it on purpose and confirming the right
test went red:

| Sabotage | Caught by |
|---|---|
| ownership predicate dropped from the projects query | *never shows another client's projects* |
| the manifest gate made unconditionally true | *refuses an entity type whose declaration has been withdrawn* |
| documents matched on `client_id` instead of the share link | *does not show a document merely filed against the client* |

Two further guards exist because a manifest and a query are written in different files:
an **inventory test** asserting the complete exposure surface (any field added anywhere
fails until someone updates the list — which is the moment the decision gets looked at),
and a **cross-check** that no query returns a column its manifest did not declare.

**A trap worth remembering:** `ManifestRegistry.register` stores what zod *parsed*, not
the object passed in. A test that mutates the imported manifest singleton is editing a
copy nothing reads — it will pass while asserting nothing. The suite runs under
`--sequence.shuffle` because the first version of these tests was order-dependent in
exactly that way, and reordering would have turned the central negative test into a
silent no-op that still reported green.

That is the same failure mode as the five bugs in Phase 6c: **it does not produce an
error, it produces a pass.**

## 5b. Step 2 — sign-in

Built: `PortalUsersService`, `PortalAuthGuard`, and one platform change described below.
Not built, because it is not code: the Zitadel project itself (§5c).

**Roles are the boundary; the audience is a supporting check.** The first version of this
had it backwards, and the correction is worth recording because the wrong version looked
right and passed its tests.

Zitadel lets a client request an arbitrary audience scope
(`urn:zitadel:iam:org:project:id:{projectID}:aud`) and **returns a token carrying that
audience whether or not the holder has any grant for it**. Offline JWKS validation cannot
tell the difference: the signature is genuine, and `aud` turns out to restate what the
client asked for rather than what it was permitted. Zitadel's own guidance is to "always
verify specific roles, scopes or custom claims in addition to checking the aud claim".

Project **roles** are different in kind. They are written into the token from server-side
grants and cannot be requested into existence, so checking one offline is a real
authorisation decision. Two roles: `internal` and `portal_client`.

So a portal request passes three gates, in this order:

| Gate | Answers | Worth alone |
|---|---|---|
| signature + issuer + expiry | is this token real | nothing about who |
| `aud` = portal application | was it minted for the portal | weak — see above |
| `portal_client` role | is the holder a client | **this is the authorisation** |
| `portal.users` row | *which* client | the data boundary |

The audience check stays because defence in depth is cheap here, and because a portal
client id equal to the internal one is a configuration error worth failing on. But it is
no longer what the separation rests on.

**This also dissolves the one-project constraint.** Roles live at project level, so a
single project with two applications and two roles gives the same separation — the
discriminator is *who the user is*, not which application they came through.

**A portal login is invited, never self-provisioned.** Internal users are created
just-in-time on first sign-in, which is right when the IdP only admits people we hired,
and exactly wrong here: with JIT, anyone able to obtain a portal-project token becomes a
portal user and the only remaining question is whose data they map to. An unrecognised
subject is refused and logged. Revocation sets a column rather than deleting the row, so
"who could see this client's invoices last year" survives the person leaving.

**And the sharpest consequence, on the internal side.** `UserService.resolveFromClaims`
provisioned any valid subject as a member. That was reasonable while Zitadel only issued
tokens to people we hired. The portal ends it: a client authenticating against the
internal application would have been handed a member account — every client's data, granted
silently, by a login that looked entirely ordinary.

Provisioning now requires the `internal` role. The gate is on **creation, not
authentication**, deliberately: gating authentication would lock out every existing user
the moment this shipped and before Zitadel was configured, and an existing row is already
an authorisation decision somebody made. The role is what it takes to write a new one.

### The platform change this forced

`portal.admin` is the first capability that hands data to someone outside the business,
and under the v0 model *members hold every declared capability* — so declaring it changed
nothing. Rather than special-case a role check inside the portal (two permission systems,
one of which drifts), `permissionSchema` gained an **`adminOnly`** flag that any module can
set. `portal.admin` is currently the only capability that uses it.

## 5c. What is yours to do in Zitadel

One project is enough — see §5b. None of this is code, and all of it blocks step 3.

1. **A second application** in the existing project, type *User Agent* / PKCE, for the
   portal front end. Its own client id is what `ZITADEL_PORTAL_CLIENT_ID` holds.
2. **Two project roles**: `internal` and `portal_client`.
3. **Grant yourself `internal`.** Do this before anything else — it is what lets a new
   internal user be provisioned. (Your existing login keeps working without it; the gate
   is on creating users, not on authenticating them.)
4. **Enable "Assert Roles on Authentication"** at project level, so roles reach the access
   token. Without it every role check fails and nobody is provisioned — loudly, which is
   the correct direction to fail, but it will look like a bug.
5. **Token Settings → Auth Token Type: JWT** on the portal application. Zitadel defaults to
   opaque tokens that cannot be validated offline; the guard names this setting in its
   error, because the generic 401 it otherwise produces cost an afternoon in Phase 6c.
6. **Login methods** — this is G4, entirely configuration: password and passwordless now,
   SSO federation later for a client that has an IdP.
7. **Turn off self-registration.** The invite check refuses unknown subjects anyway, and
   two locks on this door are correct.
8. Set `ZITADEL_PORTAL_CLIENT_ID`, and `ZITADEL_PROJECT_ID` if you want the project-scoped
   roles claim rather than the legacy flat one (both are read).

Each client login is created in Zitadel, granted `portal_client`, and then recorded here
with `invite()` against a client id — that last step is what maps a person to a company.

## 5d. Step 3 — the read-only portal

**A separate front end (`apps/portal`, port 5174), not a route in the internal app.** A
shared bundle would ship every internal component, the internal API client and every
internal route to a client's browser, leaving the separation as a router guard inside code
they had already downloaded. Verified rather than asserted: the built bundle contains no
occurrence of `tiptap`, `meetings`, `scrum`, `insights`, `Kanban` or any internal
capability string.

**The `@Public()` problem.** `AuthGuard` is an APP_GUARD, so a portal route must waive it
or it would demand an *internal* token and be unusable. `@Public()` alone would publish
every client's invoices to the internet — and nothing about reading the file would show
it: the routes work, the projection behaves, every other test passes.

So `@Public()` and `@UseGuards(PortalAuthGuard)` sit together on the class, and
`portal.controller.spec.ts` asserts the pairing mechanically, plus that no individual
route re-declares `@Public()` (which would waive the class guard for itself) and that the
route list is exactly the eight read endpoints. Step 4's first write has to edit that list.

**Serving files without importing Billing or Docs.** The portal needs bytes; the services
that own them require an `Actor` and an internal capability. Rather than reach into
another module's tables, the two views now publish where the bytes live
(`billing.v_invoices.pdf_document_id`, `docs.v_documents.storage_key`), and the portal
joins published views and reads through core `StorageService`. The module import graph is
unchanged.

One consequence worth stating: `getPdf` falls back to a live render when the archive is
missing, and **the portal deliberately cannot** — rendering means Billing. So a missing
archive is a 404 here. That made an existing silent failure worth fixing: `issue()` filed
the PDF best-effort inside `.catch(() => {})`, swallowing the error completely. It now
logs, because otherwise the first symptom is a client unable to download an invoice, weeks
later, with nothing to point at.

**404 for everything.** "Not yours", "not issued" and "no archived PDF" return the same
404. Distinguishing them would confirm to a stranger that an invoice with that id exists.

## 6. Deliberately not in this phase

- **A portal assistant.** §3.
- **Payment.** Showing what is owed is useful; taking money is a different regulated
  problem.
- **Client user management.** One login per client to start; roles inside a client
  organisation is a problem for when a client asks.
