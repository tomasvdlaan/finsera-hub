# Internal Business Platform — Decision Log

**Companion to:** Master Document · AI Integration Plan · Build Roadmap
**Purpose:** One line of truth per decision — what was decided, when, why, and what would trigger revisiting it. Gate decisions (G0–G4) are appended here as they are made.

---

## Decided

### D1 — Build approach: fully custom
**Date:** 2026-07-27 · **Status:** Decided
Fully custom build (no low-code foundation, no SaaS composition). Resolves Master §17.1.
**Why:** Maximum fidelity to the entity-registry/link/event architecture — the connected-records vision *is* the product; composition would weaken exactly that. Also serves as an internal showcase for client work.
**Revisit if:** solo velocity proves insufficient to reach Phase 2 (dogfooding) within a reasonable horizon.

### D2 — Builder model: solo, AI-assisted
**Date:** 2026-07-27 · **Status:** Decided
Tomas builds, heavily AI-assisted. No team, no agency.
**Consequence:** strictly sequential phasing, ruthless per-module MVPs, dogfooding as the quality mechanism (see Roadmap §0).

### D3 — Stack: TypeScript end-to-end — NestJS + React
**Date:** 2026-07-27 · **Status:** Decided
NestJS backend (modules/DI/in-process events/guards), PostgreSQL schema-per-module + `core` schema, Drizzle ORM, React + Vite SPA with shadcn/ui, pnpm monorepo (`apps/api`, `apps/web`, `packages/shared`). Resolves Master §14.
**Why:** Nest's primitives map one-to-one onto the architecture (modular monolith, event bus, permission guards, manifests); one language maximizes solo AI-assisted velocity; Drizzle stays SQL-close, which suits the published-reporting-views discipline.
**Rejected:** Django (+admin, but second language); Prisma (gentler, but further from SQL).

### D4 — Hosting: Hetzner (EU)
**Date:** 2026-07-27 · **Status:** Decided
Hetzner for app VPS + PostgreSQL + S3-compatible object storage, EU data centers. Resolves Master §17.2 (data residency).
**Why:** Best price/performance in the EU; pure-EU provider strengthens the residency story; monolith = one app to deploy, so hands-on ops stays manageable (Docker/Coolify).
**Accepted trade-off:** self-managed ops (Postgres backups, updates) instead of a managed PaaS.
**Revisit if:** ops burden measurably eats build time; managed Postgres (e.g. Scaleway) is the first escape hatch.

### D5 — Auth/OIDC: Zitadel Cloud (EU)
**Date:** 2026-07-27 · **Status:** Decided
Managed Zitadel Cloud, EU-hosted, from Phase 0. Separate org/tenant later for the client portal. Partially resolves Master §17.5 (portal *method* — magic link/password/SSO — stays open until Gate G4).
**Why:** No auth infrastructure to operate while solo; EU-hosted; standard OIDC as the architecture requires; portal tenant model built in. Never hand-roll auth.
**Rejected:** self-hosted Keycloak/Zitadel (ops cost), Auth0/Clerk (US-centric, per-user pricing), minimal email+password (re-plumbing auth pre-portal is real rework).

### D6 — LLM access: Vercel AI SDK as provider interface, direct API keys
**Date:** 2026-07-27 · **Status:** Decided
The AI plan's provider interface is implemented with the Vercel AI SDK; each provider is called with **direct API keys** — **no gateway/middleman (e.g. OpenRouter) in the production data path**. Default provider: **Anthropic (Claude)** — strongest multi-step tool use, zero-retention API terms to be put in place. Model routing (small/fast vs. strong) starts simple: one strong model, split later.
**Why:** Hot-swappability was the goal behind the OpenRouter idea — the AI SDK delivers it (one-line model change) *without* adding a US middleman processor to client-confidential prompts, and without normalized-API feature lag on tool-calling/PDFs/images/caching. Context and document handling are the orchestrator's job (conversation store + knowledge layer, in our own DB) regardless of provider — no provider "manages context."
**Rejected:** OpenRouter in production path (second data processor, two-hop DPA story, feature lag). *Optionally* still usable for dev-only model comparison — decide when relevant.
**Open sub-items:** execute Anthropic zero-retention/DPA paperwork before Phase 2; EU-resident fallback model (e.g. Mistral) if client DPAs demand it — evaluate at Phase 2.

### D6a — LLM provider: paid Google Gemini
**Date:** 2026-07-27 · **Status:** Decided · **Amends:** D6 · **Closes:** O9
The platform runs on the **paid** Gemini API. D6's provider interface is unchanged — the
Vercel AI SDK with a direct key, no gateway — only the default provider differs from D6's
stated intent of Anthropic.
**Why it matters:** the free Gemini tier permits using submitted content to improve
Google's products, which is incompatible with client-confidential data. The paid tier
excludes training on prompts. This was the blocking condition on Assistant v1 (Phase 2b
brief §8), and it is now met.
**Still to do:** confirm the paid-tier terms in writing against Finsera's own client DPAs
before the assistant handles anything sensitive (this is O8, not closed by D6a).
**Revisit if:** an Anthropic account becomes available — D6 still judges Claude stronger at
multi-step tool use, which is the orchestrator's whole job. Switching is one env var.

### D7 — Phase 0 green-lit per technical spec
**Date:** 2026-07-27 · **Status:** Decided · **Closes:** O1
Phase 0 (walking skeleton) approved for build against `phase0-spec.md` as drafted: core schema (§3), core service contracts (§4), manifest schema incl. AI-tools section (§5), event dispatcher design (§4), LLM provider interface (§7), 10-step build order (§10).
**Key invariants accepted:** registry ID = module row ID, written in one transaction; at-least-once event delivery with idempotent handlers and dead-lettering; permission call path complete from day one (policy permissive in v0); no AI vendor SDK outside `core/llm`.
**Exit:** Gate G0 checklist (spec §1), verified on the deployed Hetzner environment. Demo module deleted after G0.

---

## Open — with owners and due gates

| # | Decision | Due | Notes |
|---|---|---|---|
| O2 | Accounting integration: Exact Online API vs. UBL export | Gate G2 (Phase 5c) | Confirm VAT rules with bookkeeper at the same time. |
| ~~O3~~ | ~~Meeting-audio transcription~~ | **Closed 2026-07-28** | Recall.ai for capture, Gemini for transcription. See the revised G3 entry. |
| O4 | Portal auth method: magic link / password / SSO | Gate G4 (Phase 7) | Provider already fixed (Zitadel, separate tenant) per D5. |
| O5 | Assistant surface: sidebar chat vs. command palette | Before Phase 2 | Recommendation on record: sidebar first, palette later. |
| O6 | AI cost model: token budget/user/month, alerts, metering | Estimate before Phase 2; revisit at G3 | Transcription is the expected cost spike. |
| O7 | Tool-autonomy promotion criteria (draft → autonomous) | Before Phase 7 | Track record + eval pass + low blast radius. |
| O8 | Client communication on AI processing; DPA language | Before any client-facing AI (6c output / Phase 7) | Involve whoever handles DPAs. |

---

## Gate record (appended as gates are passed)

| Gate | Question | Date | Outcome |
|---|---|---|---|
| G0 | Does the core feel right to build on? | 2026-07-27 | **PASSED (with one caveat)** — see below |
| G1 | Replacing spreadsheets? Assistant answering correctly? | — | *pending* |
| G2 | Accounting + VAT confirmed? | — | *pending* |
| G3 | Transcription chosen? | — | **passed 2026-07-28** — Recall.ai, EU region, audio never persisted |
| G4 | Portal auth + security review passed? | — | *pending* |

## Phase 5a decisions (2026-07-28)

Recorded in [phase5a-quotation-brief.md](phase5a-quotation-brief.md) §4; all confirmed as
recommended.

| # | Decision | Why |
|---|---|---|
| Q1 | **No rate-card module.** Quotes carry explicit rates; accepting writes the rate onto the project. | At one client and one rate, a rate card is an abstraction over a single number. 5b generalises when a second rate exists. |
| Q2 | **No click-to-accept.** Acceptance is marked on our side. | It would be the platform's first unauthenticated public endpoint — the exact reason the Client Portal was scheduled last. Lands with Phase 7. |
| Q3 | **Sent quotes immutable; revisions create v2.** | A quote is a document you made a promise with. "Which version did they agree to?" must have an answer. |
| Q4 | **`Q2026-0001`, allocated on send, gaps tolerated, separate counter.** | No authority audits an abandoned quote; but an abandoned quote must never disturb the invoice sequence, which legally cannot have gaps. |
| Q5 | **Expiry derived from today, never stored.** | Nothing should change state while nobody is looking. An expired quote can still be accepted — honouring a lapsed price is a commercial decision. |
| Q6 | **Accepting offers a project, does not force one.** | A quote for extra work on an existing project should attach to it. That is a click, not a guess. |

### Phase 5b (2026-07-28)

| # | Decision | Why |
|---|---|---|
| C1 | **Rate cards fill the project rate; invoicing does not look rates up by work date.** | The project rate stays the single authority, so a rate card edit can never quietly change what a draft invoice bills. `rateOn()` exists and is tested, so date-based lookup remains a small change if an indexation ever crosses a project. |
| C2 | **A contract is a record with a document attached**, not a new file store. | This platform models "a file" once; Documents already does it. |
| C3 | **Notice and expiry windows derived on read**; `contract.expiring` deferred. | No scheduler exists, and nothing should change state while nobody is looking. Scheduled proactivity belongs to Phase 6's insight service. |
| C4 | **Five contract types**, `dpa` among them. | A closed list stops spellings drifting; `dpa` with a sub-processor flag is what makes open item **O8** answerable per client. |
| C5 | **`sales_draft_contract_terms` is `write:draft`** and must never infer an unstated term. | Extraction is the honest use of AI here; inventing a "standard" notice period would be worse than leaving it blank. |

**Supersedes** the parent brief's §9 note that rate cards must precede quotes. That reasoning
holds at ten clients; at one it inverts. Revisit when a second rate appears.

---

## G3 — Meeting capture and the live agent (2026-07-28) · **Decided** · *supersedes the earlier G3 entry*

**Route: Recall.ai, a hosted meeting bot that joins the Teams call.** Transcription stays
on Gemini; Recall supplies capture and speaker identity only.

### What changed from the first G3 decision

The first G3 answer assumed *we* capture audio from the browser and send it to Gemini. It
was decided before two facts were known:

1. **Meetings happen in Microsoft Teams**, usually hosted in the *client's* tenant.
2. **Speaker attribution was unsolved**, and it is the thing that makes an in-meeting
   agent useful rather than decorative. "Speaker 3 asked for supplier drill-down" is close
   to worthless for extracting action points.

A ten-route research sweep, each route adversarially reviewed, established that speaker
attribution is the real fork. Everything else is a detail by comparison.

### Why Recall

It does not diarise. It delivers **a separate audio stream per participant** (up to 16 on
Teams) with the roster identity attached — `name`, `is_host`, `email`. Attribution is a
property of the transport, not an inference. Crosstalk stops mattering because two people
talking over each other are simply two streams.

That also makes the alternatives unnecessary rather than beaten: no acoustic diarisation,
no voice-enrolment intro ritual, and no biometric voiceprints — which would have been
GDPR Article 9 special-category data, a materially larger obligation than a transcript.

It is also the most mature option, offers an EU (Frankfurt) region on pay-as-you-go, and
supports audio output so the bot can speak.

### What was rejected, and why

| Option | Why not |
|---|---|
| **MeetingBaas** | Best EU story (French SAS) and the best speaking-bot tooling, but a **single mixed mono stream** with speaker names scraped from the Teams UI. Degrades exactly when meetings get interesting. No per-participant track to fall back to. |
| **Attendee (self-hosted)** | The only zero-processor option, and genuinely tempting. Rejected on cost of *time*, not money: at ~20 meeting-hours/month a VPS costs more than the service (break-even is ~50 h/month), and Chrome-based bots break whenever Microsoft changes the Teams web UI. Absorbing that treadmill is precisely what Recall sells. |
| **Skribby** | No compliance evidence, no track record. Not for client-confidential audio. |
| **Teams' own transcript via Graph** | Post-hoc only. The artefact does not exist until transcription stops — no partials, no deltas. Fatal for a live agent. |
| **Build our own Teams bot** | Per-participant audio is genuinely available via Graph, but it is .NET, needs an Azure Bot registration and a public calling endpoint, and the multi-tenant path is hard. ~€150–300/month fixed before the first meeting. |

### The cost, stated plainly

**This accepts a US-incorporated processor receiving raw client meeting audio**, with no
self-hosted fallback. That is a bigger concession than D6 refused when it rejected
OpenRouter — audio is more sensitive than the text that decision protected.

It is accepted knowingly because the alternative that preserves D6 (self-hosted Attendee)
costs a maintenance burden a one-person business should not carry, and because the EU
region plus a DPA is a defensible position to describe to a client.

**Mitigations, all required:**
- Use the **EU region** (`eu-central-1`, Frankfurt), never the default US endpoint.
- Transcribe with **Gemini**, not Recall's built-in STT, so no *additional* processor sees
  the content. Recall is transport plus roster metadata.
- Gate on `contracts.allows_sub_processors` — a client whose DPA forbids sub-processors
  gets a notes-only meeting.
- **Self-hosted Attendee remains the documented escape hatch** for exactly that case, which
  is why capture sits behind a `MeetingCaptureProvider` interface rather than being called
  directly.

**To obtain from Recall before real client audio:** SOC 2 report and type, ISO 27001
status, the itemised sub-processor list *for eu-central-1*, whether audio ever transits US
infrastructure when using the EU region, and the DPA's SCC posture given a US entity.

### The risk that is outside our control

Microsoft ships external-bot detection (`ExternalBotAccessMode`). The default,
`RequireApprovalWhenDetected`, routes third-party bots to the lobby flagged as suspected
threats; `BlockDetectedBots` began rolling out August 2026. Microsoft 365 Copilot and
in-tenant bots are exempt — the policy is explicitly asymmetric against third parties.

Our meetings are in clients' tenants, so we control none of this. Expect a manual admit
every meeting, and expect some clients to become unreachable. **The browser dual-stream
capture is kept as a working fallback for exactly that**: no vendor, no admission, no
client cooperation, and "me versus them" attribution that is complete for a 1:1 call.

### Retained from the first G3 decision

Audio is never persisted. Consent is recorded per attendee before any capture, one refusal
blocks it, and nothing reaches CRM or the board without confirmation. Cost is metered per
meeting and displayed.

### Cost

$0.50/recording-hour (raw audio, no Recall STT), no platform fee, first 5 hours free.
Gemini transcription on top, with **voice-activity gating per stream** — four participants
for an hour is four stream-hours of audio, and transcribing all of it blindly would cost 4×
for no benefit. TTS is free at this volume (~€0.03/meeting against a 1M character/month
free tier), so it carries no weight in the decision.

---


## G4 — Portal authentication (2026-07-28) · **Decided** · *revised 2026-07-29, see below*

**Zitadel, in a separate project, with the sign-in method configured there rather than
built here.** Password, passwordless email link, and federated SSO are all things Zitadel
already does; which of them a client uses is a setting, not a deploy.

**Why this and not a magic-link implementation.** Building one means owning single-use
token generation, expiry, replay protection, rate limiting on the request endpoint, and
the reset paths around it — a meaningful amount of security-critical code to write and
then keep correct, for a login used a handful of times a year. D5 already said never
hand-roll auth; that applies with more force externally than internally.

It also keeps the options open in the way the question was actually asked: a client who
wants a password gets one, a client who wants a link gets one, and a client with their own
identity provider can federate later without any of it being a rewrite.

**~~Separate project, not separate roles.~~ Revised 2026-07-29 — it is separate roles, and
the original reasoning was wrong on a point of fact.**

The premise was that a token issued for one project is rejected by the other because the
audiences differ. That is not a boundary in Zitadel. A client may request an arbitrary
audience scope (`urn:zitadel:iam:org:project:id:{projectID}:aud`) and **receive a token
carrying that audience without holding any grant for it**; offline JWKS validation cannot
detect this, because the signature is genuine and `aud` reflects what was requested rather
than what was permitted. Zitadel's own guidance is to verify roles or custom claims *in
addition to* `aud`.

So the separation rests on **project roles** — `internal` and `portal_client` — which are
written from server-side grants and cannot be requested into existence. The audience check
stays as a supporting layer, not as the mechanism.

Two consequences:

- **One project is sufficient**, which resolved a hard constraint (only one is available).
  Two applications give distinct client ids; the roles distinguish *people*, which is the
  right axis anyway — the question was never which application a token came through.
- **Internal JIT provisioning had to be closed.** `resolveFromClaims` provisioned any valid
  subject as a member, which was fine while Zitadel only issued tokens to people we hired.
  With clients in the same instance, a client authenticating against the internal
  application would have been handed the whole business. Provisioning now requires the
  `internal` role; the gate is on creating a user, not on authenticating one, so it did not
  lock out existing logins on the day it shipped.

**The lesson, which is the same one Phase 6c produced:** the original design passed its
tests and read as correct. It was wrong about what a third party guarantees, and no amount
of testing our own code would have found it. Reading the provider's security guidance was
what found it.

**The mapping from a portal login to a client lives in our database**, not in identity
provider metadata. A `portal.users` row ties an OIDC subject to exactly one CRM client, so
"which client is this?" is answered by a foreign key rather than by trusting a claim.

**Still required before any external user (G4 is not passed by this decision alone):**
a security review of the portal specifically — an attempt to reach another client's data
through every endpoint it exposes — plus tests that assert the negative, rate limiting,
and portal reads in the audit log.

---

---

## G6 — Portal role gate temporarily off (2026-07-29) · **Decided, with an expiry**

**`PORTAL_ROLE_CHECK=off`.** The portal no longer requires the `portal_client` role.
Access rests on two gates instead of three: the portal audience, and the `portal.users`
invitation row.

**Why.** Zitadel would not emit role claims for the portal project. Verified against an
11-second-old token: the `urn:zitadel:iam:org:project:roles` scope was granted, and both
the access token and the userinfo endpoint returned no role claims of any spelling.
Several rounds of console changes did not shift it. The portal was unusable and untestable
end to end, which is its own risk — an unexercised auth path is not a safe one.

**Why this is tolerable rather than merely convenient.** The three gates were never equal.
The invitation is the strongest: it is a row *we* write, naming exactly one client, and it
is the only gate that answers "whose data". The role was defence in depth — it added "is a
client at all". Removing it means an employee reaching the portal is refused by the
invitation lookup rather than before it: a later refusal, not an absent one. There is still
no path to another client's data, because the projection binds `clientId` from that row.

**What was NOT relaxed, and must not be.** The `internal` role gate on
`UserService.resolveFromClaims` stays. It has no equivalent second control: without it a
portal client authenticating against the internal application would be JIT-provisioned as
a member. Roles not being asserted means that gate currently refuses *everyone*, which is
the safe direction — but it also means **no new internal user can be provisioned** until
Zitadel role grants work. A colleague joining would fail with "No access to this platform".

**Shape of the switch.** Opt-out by exact value (`'off'`), never by absence. An unset or
misspelled variable leaves the check ON, and a test asserts that for `''`, `'false'`,
`'no'`, `'OFF'` and `'0'`. The guard logs a warning on every boot naming the relaxation,
because a temporary weakening nobody is reminded of becomes permanent.

**Expiry.** Restore by deleting one line from `.env`. This entry exists so that deletion
is a decision someone makes rather than a thing nobody remembers.

---

## Audit log is append-only (2026-07-29) · **Decided**

Three triggers on `core.audit_log`: no UPDATE, no DELETE, no TRUNCATE. It brings the
database guarantees the API verifies at boot from ten to thirteen.

**Why it was missing.** Every other guarantee protects a record — an issued invoice, a sent
quote, an invoiced hour. Nothing protected the account of what happened to them, which is
what you reach for exactly when something has gone wrong and someone's version of events
is in doubt. Noticed while clearing test data: 48 audit rows removed with plain SQL, and
nothing objected.

**UPDATE matters more than DELETE.** A deleted row leaves a gap in the timeline; an altered
one leaves nothing at all and reads exactly like the truth. The edit worth worrying about
is not erasing that something happened — it is changing who did it.

**TRUNCATE needs its own trigger.** Row-level triggers do not fire for it, so without a
statement-level guard the whole log could still be emptied in one command: the easiest way
to destroy it, and the one the other two would not notice.

**No exception for administrators**, because the entries most worth altering are the ones
recording what an administrator did.

**Tests keep the guard live.** `resetDb` needs a clean slate and `audit_log.actor_id`
references `core.users`, so even `TRUNCATE core.users CASCADE` reaches the log. Rather than
relax the trigger for the test database — which would mean the spec asserting it no longer
tested the real thing — there is one `truncate()` helper that disables that single guard,
truncates, and re-arms it in a `finally`. Eighteen specs were routed through it.

**Retention is deliberately hard.** If entries ever need expiring — GDPR, or volume — it
takes a migration that drops the triggers, prunes, and restores them, visible in the
migration history rather than in somebody's psql session. The error message says so.

---

## G0 — Walking skeleton (2026-07-27)

**Verdict: passed.** All nine checklist criteria (spec §1) verified against the built
production stack (Caddy + API + Postgres + backup job), not just the dev server. The core
is sound to build eleven modules on.

**Caveat — one criterion is partially met.** Criterion 9 was verified locally against the
production images: `git push` → CI, migrations self-applying at boot, a real backup, and a
restore drill reproducing every row. What is NOT verified is Hetzner specifically — no TLS
issuance, no EU residency in practice, no remote deploy. The stack is deliberately
identical either way; `SITE_ADDRESS` and `deploy/.env` are the only values that change.
**Close this before Phase 2**, when dogfooding puts real client data in the database.

### What the skeleton changed about the design

Nothing structural — the registry/link/event model held up, which is the result the phase
existed to produce. Four implementation-level facts were learned by running it:

1. **Manifest validation cannot use `instanceof`.** The CJS api and ESM contracts package
   resolve to different zod instances, so class identity does not hold across that
   boundary. Structural checks only.
2. **JIT provisioning must be idempotent.** The shell loads `/me` and `/navigation` in
   parallel; both raced to insert the same user. Any first-touch write needs the same
   treatment.
3. **Tests must not share the development database.** The suite truncates; pointed at dev
   it wipes real data. Separate database plus a name guard.
4. **Postgres treats NULLs as distinct in UNIQUE indexes.** Link deduplication is enforced
   in code, not by the constraint.

### Follow-ups carried into Phase 1

- Delete the demo module (its job is done; it is the pattern CRM copies).
- Change `POSTGRES_PASSWORD` in `deploy/.env` before any real deployment.
- Provision Hetzner and close criterion 9.
