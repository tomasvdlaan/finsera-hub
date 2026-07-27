# Phase 1 Requirement Brief — CRM

**Companion to:** Master Document · Build Roadmap · Decision Log · Phase 0 Spec
**Builds on:** Gate G0 (passed 2026-07-27) — the core is proven, CRM lands on finished rails
**Status:** Draft for approval
**Date:** July 2026

---

## 1. Why this module, and what it is not

CRM is the master-data spine. Every later module references its entities: projects feed SCRUM
and time registration, client billing details feed quotation and invoicing, contacts feed the
meeting modules and the client portal. Getting the entity shapes right matters more here than
anywhere else, because eleven modules will reference them.

It is also the first module Finsera actually *runs on*. Phase 2 adds time registration and the
dogfooding gate (G1); CRM is what makes that possible by holding the real clients and projects
hours get logged against.

**Non-goals for this phase.** Rate cards with effective dates (Phase 5b), quotes (5a), invoices
(5c), tasks and boards (Phase 4), documents (Phase 3), the assistant UI (Phase 2). CRM
*declares* its AI tools now but nothing calls them yet — that is the manifest discipline working
as intended.

---

## 2. Decisions taken (from your answers)

| Question | Decision | Consequence |
|---|---|---|
| Billing models | **All four, mixed per project** | `Project` carries a `billing_model` and model-specific budget fields, rather than assuming one shape |
| Prospects | **A Client with a status** | One entity, no conversion step, and the timeline stays continuous from first contact through delivery |
| Team | **2–4 people, full mutual visibility** | Record-level permissions stay at v0; `owner` is for accountability, not access control |
| Client fields | **Basics only** | KvK/VAT/payment terms deferred — see §6 |

---

## 3. Entities

Three entity types, all owned by the `crm` module, all registered in the core registry so they
are linkable, searchable, and timeline-visible from day one.

### 3.1 Client

The company. A prospect and a customer are the same record at different stages.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | registry id — same value in `crm.clients` and `core.entities` |
| `name` | text | required; the registry display name |
| `status` | enum | `lead` → `proposal` → `active` → `dormant` / `lost` |
| `owner_id` | uuid | the internal person accountable for the relationship |
| `website` | text? | |
| `notes` | text? | free text; the "what you need to remember" field |
| `archived_at` | timestamptz? | soft delete, mirrored to the registry |

**On status.** Deliberately one flat enum rather than a pipeline stage plus a customer flag.
Two overlapping state fields is the kind of thing that drifts — a client is in exactly one place
at a time. `lost` is terminal but the record stays: losing a deal is information worth keeping,
and re-engaging a lost prospect should reuse the same timeline.

### 3.2 Contact

A person at a client. Structural FK to Client, required — a contact with no company is an
address book entry, not CRM data.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | registry id |
| `client_id` | uuid | **required**, FK within the `crm` schema |
| `name` | text | required |
| `email` / `phone` | text? | |
| `role` | text? | job title, free text — enumerating job titles never survives contact with reality |
| `is_primary` | boolean | at most one per client, enforced by a partial unique index |
| `archived_at` | timestamptz? | |

### 3.3 Project

A body of work for a client. This is the entity most other modules attach to.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | registry id |
| `client_id` | uuid | **required**, FK within `crm` |
| `name` | text | required |
| `status` | enum | `prospective` → `active` → `on_hold` → `completed` / `cancelled` |
| `owner_id` | uuid | project owner |
| `billing_model` | enum | `time_and_materials` \| `fixed_fee` \| `retainer` |
| `default_rate_cents` | bigint? | T&M and retainer overage; the seed of the Phase 5b rate card |
| `budget_amount_cents` | bigint? | fixed fee: the agreed price. T&M: the cap, if any |
| `budget_hours` | numeric? | T&M: budgeted hours, so burn is visible in Phase 2 |
| `retainer_amount_cents` | bigint? | recurring amount |
| `retainer_period` | enum? | `monthly` \| `quarterly` |
| `starts_on` / `ends_on` | date? | |
| `archived_at` | timestamptz? | |

**On money.** Integer cents plus an explicit `currency` (EUR) on the project — never floating
point. Binary floats cannot represent 0.10 exactly, and rounding drift in a system that will
produce invoices is not a bug you find early; you find it when a client queries a total.

**On the nullable budget fields.** One table with model-specific nullable columns beats three
tables or a JSON blob: invoicing (Phase 5c) needs to read a budget without knowing which shape
it is, and a `CHECK` constraint per `billing_model` keeps the combinations honest. If a fourth
model appears the cost is a column, not a migration of existing rows.

---

## 4. Manifest

The extensibility contract, filled in as the module is built — never after.

- **Entities:** `client` (`/crm/clients/:id`), `contact` (`/crm/clients/:clientId/contacts/:id`), `project` (`/crm/projects/:id`)
- **Structural refs:** `contact → client` (required), `project → client` (required)
- **Publishes:** `client.created`, `client.status_changed`, `project.created`, `project.status_changed`, `project.completed`
- **Subscribes:** none yet — Phase 2 brings the first cross-module reaction
- **Permissions:** `crm.clients.read` / `.write`, `crm.projects.read` / `.write`
- **Navigation:** Clients, Projects
- **Reporting views:** `crm.v_clients`, `crm.v_projects` — published now, per roadmap principle 4, so Phase 6a is assembly rather than archaeology
- **Portal exposure:** empty. Nothing is portal-visible by default.
- **AI tools:**

| Tool | Risk | Purpose |
|---|---|---|
| `crm_search_clients` | `read` | "which clients do we have in healthcare?" |
| `crm_get_client_overview` | `read` | the 360° view before a meeting |
| `crm_list_projects` | `read` | "what's active for De Chocolaterie?" |
| `crm_create_lead` | `write:draft` | capture a prospect from conversation |
| `crm_create_project` | `write:draft` | scaffold a project |

No `write:commit` or `restricted` tools in this module — nothing here is client-facing or
destructive. Those classes arrive with invoicing.

---

## 5. Screens

Four, kept deliberately thin. The core supplies the two most valuable panels for free.

1. **Client list** — searchable, filterable by status. The pipeline view *is* this list grouped by status.
2. **Client detail** — details, contacts, projects, and the **core timeline** (already built).
3. **Project list** — filterable by client and status.
4. **Project detail** — details, budget/burn placeholder (filled by Phase 2), **links** and **timeline** panels.

Links and Timeline are the existing shell components. They need no CRM-specific code — which is
the Phase 0 investment paying off on its first real module.

---

## 6. Deliberate deferrals

You chose "basics only", and I agree, with one thing worth naming explicitly.

**KvK, VAT/BTW number, invoice address, payment terms** are in the master document's CRM scope
but are deferred to Phase 5c (invoicing), because that is the first module that reads them.
Adding them later is additive — nullable columns on an existing table, no data migration, no
change to any other module. The cost of deferring is near zero; the cost of designing invoice
fields now, before invoicing exists, is guessing.

**Also deferred:** tags/segments, last-contact tracking, multi-currency, client hierarchies
(parent companies), and per-project team membership. Each becomes obvious — or doesn't — once
the module is in daily use.

---

## 7. Build order

| # | Step | Done when |
|---|---|---|
| 1 | Delete the demo module (backend, frontend, schema, manifest) | `pnpm -w run verify` green with no demo references |
| 2 | `crm` schema + migration; Client entity, service, manifest | A client can be created via API and appears in the registry |
| 3 | Contacts under a client | Primary-contact constraint enforced |
| 4 | Projects with billing models + CHECK constraints | Each model's fields validate correctly |
| 5 | Screens: client list/detail, project list/detail | Timeline and Links render on both detail screens |
| 6 | Reporting views + `crm_*` AI tools bound | `/api/core/ai/tools` lists them; views queryable |
| 7 | **Load Finsera's real clients and projects** | The old spreadsheet is no longer the source of truth |

Step 7 is the actual finish line. A CRM with test data proves nothing.

**Tests follow the Phase 0 pattern:** integration tests against `platform_test`, asserting the
transactional invariant (client row + registry entry commit together), the structural
constraints, and that events fire on status changes.

**Size:** M · ~3–5 weeks, consistent with the roadmap.

---

## 8. Questions for you

1. **Owner field** — should `owner_id` reference `core.users` (only real logins can own things),
   or free text for now? I lean to `core.users`, since you're 2–4 people who all have accounts.
2. **Client status list** — does `lead → proposal → active → dormant/lost` match how you actually
   think about the pipeline, or do you have a stage between proposal and active (e.g. "verbal
   yes, contract pending")?
3. **Retainer periods** — is monthly/quarterly enough, or do you have annual arrangements?
4. **Existing data** — where do your current clients and projects live (spreadsheet, Moneybird,
   somewhere else)? That decides whether step 7 is manual entry or an import script.
