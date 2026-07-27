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
| O3 | Meeting-audio transcription: third-party vs. self-hosted | Gate G3 (Phase 6c) | Most privacy-sensitive choice in the plan. |
| O4 | Portal auth method: magic link / password / SSO | Gate G4 (Phase 7) | Provider already fixed (Zitadel, separate tenant) per D5. |
| O5 | Assistant surface: sidebar chat vs. command palette | Before Phase 2 | Recommendation on record: sidebar first, palette later. |
| O6 | AI cost model: token budget/user/month, alerts, metering | Estimate before Phase 2; revisit at G3 | Transcription is the expected cost spike. |
| O7 | Tool-autonomy promotion criteria (draft → autonomous) | Before Phase 7 | Track record + eval pass + low blast radius. |
| O8 | Client communication on AI processing; DPA language | Before any client-facing AI (6c output / Phase 7) | Involve whoever handles DPAs. |
| O9 | Anthropic zero-retention / DPA paperwork | Before Phase 2 | Follows from D6. |

---

## Gate record (appended as gates are passed)

| Gate | Question | Date | Outcome |
|---|---|---|---|
| G0 | Does the core feel right to build on? | — | *pending* |
| G1 | Replacing spreadsheets? Assistant answering correctly? | — | *pending* |
| G2 | Accounting + VAT confirmed? | — | *pending* |
| G3 | Transcription chosen? | — | *pending* |
| G4 | Portal auth + security review passed? | — | *pending* |
