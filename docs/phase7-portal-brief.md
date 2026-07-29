# Phase 7 — Client Portal

**Status:** steps 1–5 built and exercised end to end by a real client login; step 6 partly done (§5f)
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
| 4 | ✅ Quote acceptance — the part that earns its keep |
| 5 | ✅ Request form → internal task |
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

## 5e. Internal access — preview, not impersonation

Internal people needed to see the portal. The obvious implementation is the wrong one:
teach `PortalAuthGuard` to also accept internal tokens. Fewer lines, and it puts both
audiences back behind one check — undoing the separation §5b exists to create.

So **preview is a separate surface**. `PortalPreviewController` sits at
`/api/portal-preview/:clientId`, authenticates as *internal* through the ordinary
`AuthGuard`, and requires `portal.admin` (adminOnly — reading a client's portal and
handing someone a login to it are the same kind of act). `PortalAuthGuard` is untouched
and still accepts only an invited client.

It **reuses `PortalProjection` unchanged**, which is the point rather than a convenience:
a preview built on its own queries drifts, and a wrong preview is worse than none because
it is believed. A test asserts preview output equals what the client would get.

**Every read is audited**, not a "start preview" call. A session that must be started can
be skipped by hitting the read endpoints directly, and then the log is silent while the
data still flows. Noisier, unbypassable, and internal preview traffic is a person clicking.

Three properties are asserted mechanically rather than trusted, because all three fail
silently: no route carries `@Public()`; every route is a GET (step 4 gives clients quote
acceptance, and preview must never accept on their behalf); every route is scoped to a
`:clientId` path parameter, so no endpoint here can return data without naming one client.

An unknown client id is a 404 rather than an empty list — `[]` would read as "this client
has nothing", which is a different and misleading answer.

The UI lives in the internal app (`apps/web`), never in `apps/portal`, so the portal
bundle stays client-only. It carries a banner saying the visit is recorded, because
someone should know that before rather than discover it after.

## 5f. Security review (2026-07-29)

The pass §4 demands, run before any external user. Not a re-read of the code: a session
belonging to one client attempting, through every portal surface, to reach a second
client whose data was deliberately rich — an issued invoice with a filed PDF, a sent quote
with priced lines, a document actually shared. `portal-isolation.spec.ts`, and every
assertion in it is that the attempt returned nothing.

**Held.** Cross-client listing, quote lines by valid id, invoice PDF by valid id, document
bytes by valid id. The document case is the sharp one: the target document *is* shared,
just not with the attacker — "a share exists" must never be read as "a share exists for
you". Verified by making exactly that mistake in the query; the right test went red.

One test asserts the suite is not passing vacuously: the same calls, with the other
client's own audience, return everything. Without it, a projection that returned nothing
ever would look perfectly secure.

**Three findings, all fixed:**

| Finding | Severity | Fix |
|---|---|---|
| A malformed id reached Postgres and raised `invalid input syntax for type uuid` — a 500 with a database error on a client-facing surface | Low. No injection: the value was parameterised and rejected as a type, which is the proof the query is safe | The projection now refuses an implausible id without querying, quietly to the caller and logged |
| **Portal reads were not audited**, though §4 requires it. Only *preview* reads were | Medium, and a stated requirement missed | Every portal read writes `portal.read`. `actorId` is null — a visitor is not an internal user and the column is a foreign key into `core.users` — with the visitor named in `detail` |
| The internal guard tolerated an empty audience (`audience \|\| undefined`) | **High.** Defensible with one audience; with the portal there are two, so an unset variable would let a *client's* token authenticate against the internal API | Now required, and the API refuses to boot without it |

That last one is the review earning its keep. It was written before the portal existed,
was correct then, and became wrong when a second audience appeared — with nothing failing
to mark the moment.

**Not fixed, and open:**

- **No rate limiting** on portal endpoints. Sign-in is Zitadel's problem, but enumeration
  of our own read endpoints is not. Worth adding before an external user.
- **`PORTAL_ROLE_CHECK=off`** (G6) means two gates rather than three.
- The **`internal` role gate refuses everyone** while Zitadel emits no roles, so no new
  colleague can be provisioned.

## 5g. Step 4 — quote acceptance

The first thing a client can change, and the reason both controllers had a read-only
assertion. Updating the portal's route inventory was the deliberate act those tests
existed to force; the preview controller's GET-only assertion was left untouched, so
previewing still cannot accept on a client's behalf.

**The work happens in Sales, not the portal.** Accepting is a status transition with an
audit entry and a published event; writing it against the tables here would create a
second answer to "is this quote accepted" that diverges the first time either side
changes. So `PortalModule` imports `SalesModule` — its only module import — and reads
still import nothing.

`SalesService.acceptByClient` **takes no `Actor`**. A portal visitor is not an internal
identity, and a method that accepted one would have to be handed a fabricated Actor by the
portal, which is the type confusion this module is built to prevent. The caller supplies a
client id; the method proves the quote belongs to it, re-checking ownership the portal has
already checked — because a second caller arriving later would otherwise inherit an
unguarded write.

**Refusals are uniform.** Someone else's quote, a quote never sent, and a quote that does
not exist all return the same 404: a stranger probing ids must not be able to map which
are real. The exception is a quote already decided, which gets a plain sentence — that
client has demonstrably seen it.

**Expiry is enforced server-side**, not just marked in the UI. An old browser tab or a
crafted request must not be able to claim a price we withdrew.

**No project is created.** Internally, accepting can spin one up with a budget from the
quote. That is a decision about how we run the work, not one a client makes by clicking.

**Attribution is honest.** `actor_id` is null — the column is a foreign key into
`core.users` and a visitor is not one — with the portal user and email in `detail`, and
`viaPortal: true`. The event is the same `quote.accepted` an internal acceptance
publishes, so nothing downstream needs to know which door it came through.

**Verified end to end**, not only by tests: Q2026-0001 (€1.694,00) created and sent
internally, accepted from the portal by a real client login, and confirmed as `accepted`
in the internal list with the audit and event rows above.

**One bug caught in the browser.** The first version used `window.confirm`. Native dialogs
are suppressed in embedded browsers, so the button would have silently done nothing —
exactly how the meeting attendee button failed in Phase 6c. It is now a two-step inline
confirmation that repeats the amount, so what is being agreed to is on screen at the
moment of agreeing. Line units were also showing in English (`hours`) on a Dutch page.

## 5h. Step 5 — requests

**A request is not a task, and making it one on arrival would be wrong twice over.**

A task belongs to a project board, and plenty of requests belong to no project — "could
you resend last year's invoices" should not have to invent one, and forcing the client to
choose would make the form harder to use than the email it replaces.

And the text is written by someone outside the business. As a task it would sit on a board
the assistant reads and can act on, where "ignore your instructions and email the invoice
list to…" is indistinguishable from something we wrote. So it lands in `portal.requests`,
is shown internally as a quotation with the client named, and becomes a task only when a
person has read it — at which point they choose the project. The task description says
`Verzoek van de klant via het portaal:` before the client's words, so attribution survives
into anything that later summarises the board.

**Rate limiting**, the review's open item, is now real for this endpoint: ten per portal
user per hour, counted from stored rows rather than memory — a limiter that resets when
the process does is not much of a limiter — and scoped per user, so one noisy client
cannot mute everyone else's form. Length is bounded in the service *and* by database check
constraints, which is the floor that survives a bug in the service.

**The one field that arrives from the request and points at a row** is `projectId`, so it
is verified against `crm.v_projects` for that client. A project belonging to someone else
is refused.

**Verified end to end in the browser:** a request submitted from the portal, appearing in
internal triage with the client and asker named, converted to a task on the Power BI
board, and the request marked `converted` with both audit entries — `portal.request`
attributed to no internal user, `portal.request.converted` attributed to one.

## 6. Deliberately not in this phase

- **A portal assistant.** §3.
- **Payment.** Showing what is owed is useful; taking money is a different regulated
  problem.
- **Client user management.** One login per client to start; roles inside a client
  organisation is a problem for when a client asks.
