# Internal Business Platform — Build Roadmap

**Companion to:** Master Document (vision, module scope, architecture) · AI Integration Plan (AI as a horizontal layer)
**Assumptions locked for this plan:** Fully custom build · Built by Tomas, AI-assisted (effectively one developer) · AI is a first-class, horizontal capability of the platform · Deliverable = phased build roadmap
**Date:** July 2026

---

## 0. How to read this roadmap

The master document answers *what* to build and *how it fits together*. The AI integration plan answers *how intelligence rides on top of it*. This roadmap answers *in what order one AI-assisted developer builds both tracks, how to know each step is done, and where to stop and decide.*

Four realities drive every choice below:

1. **One builder means no parallelism.** Modules land one after another; the AI layer interleaves rather than running as a separate team's workstream. Sequencing and ruthless per-step MVPs matter more than either source doc implies.
2. **The core is the whole bet.** The entity registry, link service, and event bus are what make this worth building instead of buying 11 SaaS tools — *and* they're what the AI layer needs to exist at all (identity to resolve, APIs to call, events to watch, permissions to inherit). They must be proven end-to-end before real modules are built on them.
3. **AI is horizontal, not a phase you reach.** Because AI is a layer over the core, the *hooks* for it (the tool-declaration section of the manifest, the provider interface) must exist from the start, even though the assistant itself ships once there are modules worth talking to. Get the hooks in early; the intelligence accrues for free per module afterward.
4. **Dogfooding is the forcing function.** The moment CRM + Time Registration work, Finsera runs its own business on them — and the assistant gets real data to be useful against. Daily use surfaces the design mistakes a solo builder can't catch by reasoning alone.

---

## 1. Recommended stack (resolving enough of the open questions to start)

You chose "fully custom," which settles the shape. Below is a concrete, opinionated stack tuned for *one AI-assisted developer* — priorities: a single language, module boundaries expressed in the framework itself, and excellent AI-tooling support. The last three rows are the AI layer's infrastructure.

| Concern | Recommendation | Why (for this build) |
|---|---|---|
| **Language** | TypeScript, front and back | One language = less context-switching; largest, best-supported corpus for AI-assisted coding. |
| **Backend** | **NestJS** | Its module system, DI, in-process `EventEmitter`, and guards map almost one-to-one onto your architecture: modular monolith, event bus, permission guards, manifests. Best fit in the TS world. |
| **Database** | **PostgreSQL**, schema-per-module + `core` schema | Exactly as the master doc specifies. |
| **ORM** | **Drizzle** (or Prisma) | Both support multi-schema Postgres. Drizzle is SQL-close (good for the reporting-views discipline); Prisma is gentler. Either works. |
| **Frontend** | **React + Vite** SPA, component library (shadcn/ui or Mantine) | The "application shell" = a React app where each module registers routes/widgets; a component library gives the consistent UI framework for free. |
| **Auth / OIDC** | Managed EU-region (Zitadel Cloud) or self-hosted (Zitadel/Keycloak) | Standard OIDC; separate-tenant support covers the future client portal. Don't hand-roll auth. |
| **File storage** | S3-compatible, **EU region** (Hetzner / Scaleway / OVH) | Satisfies data residency cheaply. |
| **Hosting** | Single EU VPS/PaaS to start (Hetzner / Scaleway / Railway EU) | A modular *monolith* deploys as one app — keep ops trivial while solo. |
| **LLM access** | **Provider interface** over an EU-residency / zero-retention API (e.g. Claude via API, or an EU-hosted model); routable per task | The AI plan's model-agnostic orchestrator: a small fast model for classification/autocomplete, a strong model for reasoning/drafting. Never call a vendor SDK directly from module code. |
| **Retrieval / vectors** | **pgvector** in the same Postgres | Keeps the vector index in your own DB (privacy), extends the core search service — no separate vector DB to operate. |
| **AI orchestration** | Custom core service (tool-calling loop), not a heavyweight framework | The orchestrator is small and central; owning it keeps risk-class enforcement and permission-inheritance under your control. |

**Alternative:** Django (Python) fits the module model too and its admin gives free internal CRUD early — but it costs a second language, and the AI orchestration ecosystem is no better there. For a solo AI-assisted build, **NestJS+React wins on velocity.**

**Decisions that block starting:** confirm this stack, pick the EU host, choose an initial LLM provider + data terms (see §6). Everything else has a gate later.

---

## 2. The AI layer — a horizontal capability

AI is not module twelve; it's a layer over the core with four components (per the AI plan), all built on services that already exist:

- **Tool registry** — each module's manifest gains a **ninth section: AI tools** (name, NL description, input/output schema, permission, risk class `read` / `write:draft` / `write:commit` / `restricted`). The orchestrator assembles the tool set per conversation from the manifests of modules the *user* may access — the same MCP-style pattern as navigation and permissions.
- **Orchestrator** — a core service: takes the user message + page context, retrieves knowledge, calls the LLM with the allowed tools, executes tool calls *through module APIs under the user's identity*, loops, streams the answer with citations. It enforces the risk classes (`read` silent, `write:draft` shows the draft, `write:commit` confirms first, `restricted` refuses).
- **Knowledge layer** — three retrieval paths in preference order: **structured tool calls** (default, always current, always permission-checked), **semantic search** (pgvector over notes/docs/wiki, each chunk carrying its entity ID + permission scope, filtered *before* reaching the model), and **the link graph** (resolves "the meeting last Tuesday with De Chocolaterie" to `meeting:123`).
- **Conversation store** — persisted per user, linkable to the entities a conversation touched.

AI shows up in three forms of increasing autonomy, all on this one layer: **the Assistant** (platform-wide chat that can act), **Embedded AI** (draft/summarize buttons inside module screens), and **Proactive AI** (an insight service subscribing to the event stream that *proposes* actions). The Meeting Agent becomes the first specialized application of this layer, not a standalone island.

**The single most important sequencing rule:** the manifest's tool-declaration format and the provider interface are designed in **Phase 0**, and **every module declares its AI tools in its manifest as it is built** — even in phases before the assistant exists. This is cheap when done inline and expensive to retrofit. The assistant itself first ships once ≥2 modules expose tools (around Phase 2–3); semantic search arrives with the first real document corpus (Phase 3).

**Honest effort note:** "free per module" is architecturally true but not labor-free. The orchestrator, retrieval, conversation store, embedded features, and proactive service are real build work — roughly **15–25 focused build-weeks spread across the phases**, on top of the module estimates. Every tool starts in `write:draft` and is promoted only after a track record; each ships with a small eval set so quality is measured, not assumed.

---

## 3. The refined phasing

The master doc has 5 confirmed phases + expansion. This roadmap **inserts a Phase 0** (the missing walking skeleton) and **splits the original Phase 1**, then threads the AI track through each phase. Every AI step uses only modules that exist by then.

Effort is **T-shirt size** + a **rough focused-build-week range** for one AI-assisted developer working consistently. Weeks are *relative* sizing, not a committed date.

---

### Phase 0 — Walking Skeleton *(new — the most important phase)*

**Module goal:** prove the entire architecture with the thinnest vertical slice before any real module exists.

**Build:** repo, CI, one-command EU deploy; OIDC login end to end; `core` schema (entity registry, polymorphic `link` table, event-log/outbox + dispatcher, minimal permission check, audit log); app shell; one throwaway demo module that registers an entity, links it, publishes an event, and has a subscriber react — plus a core-driven timeline query.

**AI this phase:** define the **manifest tool-declaration format** (the ninth section) and stub the **LLM provider interface**. No assistant yet — just the hooks, so nothing needs retrofitting later.

**Done when:** the §13 worked example runs in miniature with throwaway entities, deployed; the manifest schema already has a place for AI tools.

**Size:** M · ~3–5 wk · **Gate G0:** *does the core feel right to build on?* Correct the registry/link/event/manifest design here, cheaply, before proceeding.

---

### Phase 1 — Foundation: CRM

**Module goal:** the master-data spine every module references.

**Build (MVP first):** client records (company, billing, KvK/VAT) + contacts; projects under clients (status, budget, rates, dates, owner); client activity timeline (now a trivial core query); basic pipeline (lead → proposal → won/lost). Register `client`/`project`/`contact` types; write the manifest.

**AI this phase:** CRM **declares its tools** in the manifest — `search_clients`, `get_client_overview` (`read`), `create_lead` (`write:draft`). No assistant UI yet; the declarations wait for it.

**Done when:** Finsera's real clients and projects live in the system with linked activity.

**Size:** M · ~3–5 wk

---

### Phase 2 — Foundation: Time Registration + **assistant v1** + start dogfooding

**Module goal:** close the original Phase 1 and get to daily real use fast.

**Build:** fast timesheet entry (<1 min/day — protect this goal); billable/non-billable; structural link `time_entry → project (required)`; utilization + budget-burn basics; weekly submission; publish `timesheet.approved`. Declare Time's tools.

**AI this phase:** now that CRM + Time expose tools, build **Orchestrator v1 + provider interface + assistant chat shell + conversation store**. Launch **read-only Q&A** across CRM/Time/projects ("open work on project X?", "hours logged this week?") plus the first `write:draft` tool (`create_lead`), with citations and confirmation on writes. First eval set.

**Done when:** you log real hours weekly *and* can ask the assistant real questions about live data.

**Size:** L (module M + assistant build) · ~6–9 wk · **Gate G1:** *is the platform genuinely replacing spreadsheets, and does the assistant answer correctly on real data?* Fix adoption/quality before building on top.

---

### Phase 3 — Delivery: Document Management + the knowledge layer

**Module goal:** the file backbone nearly every later module files into.

**Build:** per-client/per-project library, versioning, folder/document permissions, full-text search, the core file-storage service (later reused by Meeting Notes). Owns `document`. Declare `search_documents`, `get_document_summary`.

**AI this phase:** stand up the **semantic-search knowledge layer (pgvector)** over documents — the first real corpus — with per-chunk entity ID + permission scope, filtered before the model. First **embedded AI**: on-upload summarization + auto-tagging, "ask this document" for long contracts, suggested filing location.

**Done when:** contracts/proposals/deliverables live here with versioning, search, and grounded "ask this document."

**Size:** L · ~5–7 wk

---

### Phase 4 — Delivery: SCRUM / Task Tracking

**Module goal:** structure delivery work; feed timelines and (later) the portal.

**Build:** backlog + board per project (configurable columns; plain-kanban mode), tasks (assignee, estimate, priority, labels, due date), sprints + simple burndown, epics/groups; link tasks to time entries. Declare `create_task`, `move_task`, `list_open_tasks`.

**AI this phase:** assistant gains `create_task` (`write:draft`); **embedded AI** to break an epic (or a meeting outcome, once notes exist) into concrete tasks with estimates and draft acceptance criteria.

**Done when:** a live project runs on the board with hours logged against tasks, and the assistant can propose task breakdowns.

**Size:** L · ~4–6 wk

---

### Phase 5 — Commercial loop: Quotation → Contracts → Invoicing + the commercial assistant

**Module goal:** close the money cycle (quote → contract → project → hours → invoice) on centrally managed rates. Three modules, built in this internal order because rates/budgets flow downstream.

- **5a — Quotation** ✅ *built 2026-07-28, see [phase5a-quotation-brief.md](phase5a-quotation-brief.md)* **:** quotes from rate cards/templates; versioning; branded PDF + click-to-accept; statuses feed pipeline; `quote.accepted` → project scaffold + filed PDF. Tools: `create_draft_quote`, `get_quote_status`. *(M, ~3–4 wk)*
- **5b — Contracts & rate cards** ✅ *built 2026-07-28, see [phase5b-contracts-brief.md](phase5b-contracts-brief.md)* **:** register (framework/SOW/NDA/DPA), rates + indexation with effective dates, renewal/notice alerts, project→contract links, `contract.expiring`. Rate cards become the single source feeding quotation/time/invoicing. Tool: `extract_contract_terms`. *(M, ~3–4 wk)*
- **5c — Invoicing** ✅ *core built 2026-07-27; sending and reminders outstanding* **:** drafts from `timesheet.approved` (T&M) or milestones (fixed fee); VAT (21% / reverse-charge / exempt); sequential numbering; PDF send + status + reminders; credit notes; accounting export. Tools: `create_draft_invoice` (`write:draft`); `send_invoice` stays **`restricted` — not exposed to the assistant initially.** *(L, ~4–6 wk)*

**AI this phase (the "generate a quote from a chat message" milestone):** draft quotes from meeting notes + rate cards; invoice-line descriptions generated from time entries; escalating payment-reminder drafts; contract-term extraction into structured fields (human-verified). This is where the AI plan's headline scenario becomes real.

**Size (combined):** XL · ~11–16 wk · **Gate G2 (before 5c):** *accounting integration* (Exact Online API vs. UBL) **and confirm VAT rules with your bookkeeper** — the one module where a bug has legal/financial consequences; test against known-correct invoices.

---

### Phase 6 — Intelligence: Reporting, Meeting Notes, Meeting Agent, Proactive AI

**Module goal:** layer insight and AI onto now-rich data. Given your BI background, Reporting is also a client-facing showcase.

- **6a — Reporting & Dashboards:** each prior module publishes stable read-only **views** (retrofit now); role-based dashboards (revenue/client, utilization, project profitability, pipeline, overdue invoices, renewals); drill-down; Power BI reads the same views. Pure consumer. **AI:** natural-language querying translated to the published views; anomaly annotations. *(L, ~4–6 wk)*
- **6b — Meeting Notes:** WYSIWYG editor (headings, lists, tables, checkboxes, embeds), templates, note↔client/project/attendee links, action-item → SCRUM task, cross-platform search. **AI:** note summarization, action-point extraction as draft tasks; CRM "prep me for De Chocolaterie" timeline summaries; tone-matched follow-up drafts. *(M, ~3–5 wk)*
- **6c — Meeting Agent** (first specialized app of the AI layer): recording + transcription with **explicit EU/Dutch consent** (visible recording state, per-attendee consent); auto minutes into the editor; detects action points/decisions/questions as *draft* tasks for confirmation; optional live agenda-drift assistant. Human confirms before anything writes to CRM/SCRUM. *(L–XL, ~5–8 wk)*
- **Proactive AI — insight service:** subscribe to the event stream; launch rules: budget outpacing timeline, quotes unanswered past threshold (→ drafted follow-up), invoices overdue (→ drafted reminder), contract renewal windows (→ prep summary), unsubmitted hours at week-end, tasks stuck > N days. **Proposes only; never acts alone.** *(M, ~3–4 wk, threads through 6)*

**Size (combined):** XL · ~15–23 wk · **Gate G3 (before 6c):** *transcription — third-party service vs. self-hosted*, the single most privacy-sensitive choice, given client-confidential audio. **Order within Phase 6 is flexible:** if meetings hurt more than reporting day-to-day, build 6b before 6a — Meeting Notes has no hard dependency on Reporting.

---

### Phase 7 — External: Client Portal + cautious externalization

**Module goal:** turn the platform into a client-facing differentiator — built last because its value depends on internal modules being full, and it needs the most security attention.

**Build:** separate hardened surface, own auth (separate OIDC tenant), per-client login scoped to their own ID; project status, shared documents (optional approval flows), quotes for digital acceptance, invoices with payment status, request/ticket form → internal lead/task. Explicit per-entity portal allow-list from each manifest; nothing portal-visible by default.

**AI this phase:** an optional **portal assistant** with an **isolated, stricter tool set** answering only from portal-visible data — internal knowledge is *architecturally unreachable, not just filtered* — clearly labeled as AI. Begin **expanding tool autonomy** only where the track record justifies it (e.g. auto-filing documents without confirmation).

**Size:** L · ~5–7 wk · **Gate G4:** *portal auth* (magic link / password / SSO) **and a security review before any external user — or external-facing assistant — goes live.** The one surface where a permission leak exposes client data externally.

---

### Phase 8+ — Expansion (as-needed, no core changes)

Resource planning, knowledge base (reuses the WYSIWYG editor *and* becomes prime semantic-search material), expenses, leave/absence, e-mail integration. Each = build against core services + write a manifest (including its AI tools). New modules are instantly assistant-usable. **Build only when real need appears.**

---

## 4. Roadmap at a glance

| Phase | Module track | AI track | Size | ~Weeks | Gate |
|---|---|---|---|---|---|
| 0 | Walking skeleton (core proven) | Manifest tool format + provider interface (hooks only) | M | 3–5 | **G0** core feels right |
| 1 | CRM | CRM declares tools | M | 3–5 | — |
| 2 | Time Registration + dogfood | **Orchestrator v1 + read-only assistant** + conversation store | L | 6–9 | **G1** replaces spreadsheets & answers correctly |
| 3 | Document Management | **Semantic search (pgvector)** + first embedded AI | L | 5–7 | — |
| 4 | SCRUM | `create_task` + epic→tasks breakdown | L | 4–6 | — |
| 5 | Quotation → Contracts → Invoicing | **Commercial assistant** (draft quotes/invoices/reminders, term extraction) | XL | 11–16 | **G2** accounting + VAT |
| 6 | Reporting; Meeting Notes; Meeting Agent | NL reporting, Meeting Agent, **proactive insight service** | XL | 15–23 | **G3** transcription choice |
| 7 | Client Portal | Portal assistant (isolated), autonomy expansion | L | 5–7 | **G4** portal auth + security review |
| 8+ | Expansion modules | Tools declared per manifest (auto-usable) | — | as needed | per module |

**Rough total to end of Phase 7:** ~50–75 focused build-weeks of module scope **+ ~15–25 for the AI layer** woven in. Solo and AI-assisted, part-time, that's realistically an **18–30 month journey for the full AI-rich scope** — which is exactly why Phases 0–3 are shaped to deliver a usable, assistant-backed platform within the first several months, long before the whole is done.

---

## 5. Principles that keep a solo build on track

**Module discipline**
1. **MVP every step, then move on.** Ship the thinnest useful version, dogfood it, deepen only when daily use demands it.
2. **Never break core discipline for speed.** Modules touch only their own schema; cross-module data goes through APIs/events; reporting reads published views only. AI assistants will happily suggest the shortcut — don't take it.
3. **Write the manifest for every module** — now including its **AI-tools section** — as you build it, never after.
4. **Retrofit reporting views as you go**, so Phase 6a is assembly, not archaeology.

**AI discipline** (from the AI plan's trust/safety section — enforce in code, not by the model's judgment)
5. **Read freely, write carefully.** `read` executes silently; every create/change is a `write:draft` shown for one-click confirmation; client-facing or destructive actions are never below `write:commit`; some (`send_invoice`) stay `restricted`.
6. **The assistant is the user.** Every tool call runs under the requesting person's permissions through the same module APIs — no broad AI service account, ever.
7. **Untrusted content is data, not instructions.** Documents, e-mails, and transcripts can contain prompt-injection; delimit retrieved content as data, and keep high-risk tools confirmation-gated regardless of what any content says.
8. **Everything auditable, sources shown.** Every AI tool call lands in the audit trail (AI-initiated / human-confirmed, with a conversation reference); answers cite their source records via registry links.
9. **Evaluate before promoting.** New tools ship in `write:draft` with a small eval set; promote to more autonomy only on a track record.

---

## 6. Open questions — status for this plan

| Source | Question | Status |
|---|---|---|
| Master §17.1 | Build vs. compose | **Resolved** — fully custom. |
| Master §14 | Stack | **Proposed** (§1). Confirm before Phase 0. |
| Master §17.2 | Hosting / data residency | **Pick before Phase 0** — EU host + EU object storage. Low-effort. |
| Master §17.3 | Accounting integration | **Gate G2** (Phase 5c) — Exact Online API vs. UBL. |
| Master §17.4 / AI §2 | Meeting-audio transcription (self vs. 3rd-party) | **Gate G3** (Phase 6c) — most privacy-sensitive choice. |
| Master §17.5 | Portal authentication | **Gate G4** (Phase 7). |
| AI §1 | LLM provider(s) + data terms; one model or routed per task | **Pick an initial provider before Phase 2** (needed for orchestrator v1); zero-retention / EU-residency terms required. Routing can start simple (one strong model) and split later. |
| AI §3 | Assistant surface — sidebar chat, command palette, or both | **Decide before Phase 2.** Recommend: start with a sidebar chat (context-aware to the current page); add a command palette later. |
| AI §3 | AI cost model — token spend per user/month, budget alerts, metering heavy features | **Estimate before Phase 2, revisit at Phase 6c** (transcription is the cost spike). Add per-user budget alerts early. |
| AI §5 | Autonomy criteria — when a tool graduates from draft+confirm to autonomous | **Define the promotion rule before Phase 7.** Track record + eval pass + low blast radius. |
| AI §6 / clients | What clients are told about AI processing; processing-agreement language | **Resolve before any client-facing AI (Phase 6c output, Phase 7 portal).** Involve whoever handles your DPAs. |
| Master §17.6 | Internal platform ownership | **You, for now** — revisit once live and others depend on it. |

**Only four decisions block starting:** confirm the stack, pick the EU host, choose an initial LLM provider + data terms, and green-light Phase 0's scope. Everything else has an explicit gate.

---

## 7. Recommended immediate next step

Start **Phase 0**, not Phase 1 — and make sure Phase 0 includes the AI hooks (manifest tool-section format + provider interface), not just the core. A real module on an unproven core bakes in whatever's wrong with the registry/link/event design; a module built *without* a place to declare its AI tools forces a retrofit the moment the assistant ships. Both are avoided by getting Phase 0 right.

If you want, the next planning session can produce a **Phase 0 technical spec**: the exact `core` schema tables, the NestJS module skeleton, the outbox/event-dispatcher design, the manifest schema **including the AI-tools section**, the provider-interface contract, and the first walking-skeleton vertical slice — ready to start coding.
