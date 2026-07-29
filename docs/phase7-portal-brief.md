# Phase 7 — Client Portal

**Status:** step 1 built (projection + exposure enforcement); G4 decided
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

Zitadel is already fixed (D5), with a **separate tenant** so a portal account can never be
an internal account. What is open is the method:

| | For | Against |
|---|---|---|
| **Magic link** *(recommended)* | Nothing to remember, nothing to reset, no password to leak. A finance person logging in twice a year will never remember a password | Email becomes the security boundary; a forwarded link is an account |
| **Password** | Familiar; works when email is slow | Password reset flows, storage, and the reset flow is itself an attack surface |
| **SSO into their own tenant** | Best security, no new credential | Only works for clients with an IdP, and needs setup per client — for one client, weeks of work for one login |

**Decided:** none of them, in the sense that we do not build any. All three are Zitadel
features, so the method is a **configuration choice in the portal project**, not code
here. What this codebase does is verify a token from that project and look up which
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
- **Rate limiting** on the login endpoint, because a magic-link request form is a mail
  bomb otherwise.
- **The audit log covering portal reads**, not just writes. Who saw what matters more
  externally than internally.

## 5. Build order

| Step | Deliverable |
|---|---|
| 1 | ✅ Portal projection layer + `portalExposure` enforcement, with negative tests |
| 2 | Zitadel portal project, token verification, rate limiting |
| 3 | Read-only portal: projects, documents, invoices |
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

**Audience separation is the whole mechanism.** Both projects live in the same Zitadel
instance and share an issuer, so a valid signature does not distinguish an internal token
from a portal one — only the `aud` claim does. Without that check an internal user's token
would pass the portal guard and be resolved against `portal.users`, leaving the entire
separation resting on that lookup failing to find a row.

So the portal guard requires its audience, where the internal guard tolerates an empty one
(`audience || undefined`). That tolerance is defensible for a single trusted tenant and
indefensible here: an unset variable would silently turn the check off. **An unconfigured
portal refuses every request rather than accepting any token the instance ever issued.**

It warns at boot instead of dying only because the portal has no endpoints yet — failing
the whole platform's boot over an unreachable feature would be theatre. A portal client id
*equal* to the internal one is fatal, because that is a wrong configuration rather than a
missing one, and its symptom is an internal token quietly working.

**A portal login is invited, never self-provisioned.** Internal users are created
just-in-time on first sign-in, which is right when the IdP only admits people we hired,
and exactly wrong here: with JIT, anyone able to obtain a portal-project token becomes a
portal user and the only remaining question is whose data they map to. An unrecognised
subject is refused and logged. Revocation sets a column rather than deleting the row, so
"who could see this client's invoices last year" survives the person leaving.

### The platform change this forced

`portal.admin` is the first capability that hands data to someone outside the business,
and under the v0 model *members hold every declared capability* — so declaring it changed
nothing. Rather than special-case a role check inside the portal (two permission systems,
one of which drifts), `permissionSchema` gained an **`adminOnly`** flag that any module can
set. `portal.admin` is currently the only capability that uses it.

## 5c. What is yours to do in Zitadel

None of this is code, and all of it is a prerequisite for step 3.

1. **New project** — call it `Finsera Portal`. A separate project, not a new application
   inside the existing one: the point is a distinct audience.
2. **New application** inside it, type *User Agent* / PKCE, for the portal front end.
3. **Token Settings → Auth Token Type: JWT.** Zitadel defaults to opaque tokens, which
   cannot be validated offline. The guard names this setting in its error, because the
   generic 401 it otherwise produces cost an afternoon during Phase 6c.
4. **Login methods** — this is G4, and it is entirely configuration. Enable password and
   passwordless (magic link); add SSO federation later for a client that has an IdP.
5. **Turn off self-registration** for the project. The invite check refuses unknown
   subjects anyway, but two locks on this door are correct.
6. Put the application's client id in `ZITADEL_PORTAL_CLIENT_ID` (see `.env.example`).

The subject for a new client login comes from Zitadel once the person exists there; that
is what `invite()` records against a client id.

## 6. Deliberately not in this phase

- **A portal assistant.** §3.
- **Payment.** Showing what is owed is useful; taking money is a different regulated
  problem.
- **Client user management.** One login per client to start; roles inside a client
  organisation is a problem for when a client asks.
