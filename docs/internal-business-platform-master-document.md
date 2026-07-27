# Internal Business Platform — Master Document

**Status:** Concept / definition phase
**Date:** July 2026
**Owner:** Tomas
**Scope of this document:** Complete overview — vision, module scope, architecture, phasing, and open decisions. Supersedes the separate project and architecture documents.

---

## Part I — Vision and Scope

### 1. Purpose and Vision

The goal is to build a single internal platform that structures how the business operates: who our clients are, what work we do for them, who spends time on what, and what was agreed in meetings. Today this information lives in separate tools, spreadsheets, and people's heads. The platform brings it together so that a client, a project, a task, a logged hour, a meeting note, and an invoice are all connected records in one system.

The platform is explicitly **modular**: each functional area is a self-contained module that plugs into a shared core. Modules can be built, replaced, or added independently, so the system grows with the business rather than being designed once and outgrown.

The value of the platform is not in any single module — it is in the connections between them. A meeting is linked to a client and a project; a time entry is linked to a person, a project, and possibly a task; an invoice is built from time entries and governed by a contract. Making these links first-class, while keeping modules independent, is the central design challenge — Part III describes the architecture that achieves it.

### 2. Design Principles

**Modular architecture.** Every module is developed against a shared core (authentication, permissions, shared data entities, notifications, search). A module can be enabled or disabled per user or per team without affecting the rest of the system.

**Shared data model.** The core entities — Client, Contact, Project, Task, Person (employee), Meeting, Time Entry, Quote, Invoice, Contract, Document — are defined once and referenced by all modules. The CRM owns the Client entity; the SCRUM module owns Tasks but links them to Projects; time entries reference both a Person and a Project/Task. This linking is what makes the platform more valuable than separate tools.

**Extensibility first.** New modules should be addable without touching existing ones. Practically this means: a documented internal API per module, event-based communication (e.g. "invoice created", "meeting ended" events that other modules can subscribe to), and a consistent UI framework so new modules look and behave like existing ones.

**Single source of truth.** Data is entered once and reused. A client's billing details entered in the CRM flow automatically into the quotation and invoicing modules; hours logged in time registration become draft invoice lines; an accepted quote becomes a project.

**Audit and traceability.** Because the platform will hold financial and client data, every mutation on core entities is logged (who, what, when).

## Part II — Module Scope

The confirmed scope consists of eleven modules, grouped by function: Client & Commercial (CRM, Quotation, Contracts), Delivery (Time Registration, SCRUM, Meeting Notes, Meeting Agent), Financial (Invoicing), and Information & Insight (Document Management, Reporting & Dashboards, Client Portal).

### Client & Commercial

#### 3.1 CRM Module — Clients and Projects

The foundation of the platform. It holds the master data every other module builds on.

Functionality: client records (company details, billing information, KvK/VAT numbers, contract terms) with linked contact persons; project records under each client with status, budget, agreed rates, start/end dates, and a project owner; an activity timeline per client aggregating events from other modules (meetings held, quotes sent, invoices sent, projects delivered); and pipeline tracking for prospects (lead → proposal → won/lost) so business development lives in the same system as delivery.

Key integrations: projects feed the SCRUM module, rates and billing details feed the quotation and invoicing modules, contacts feed the meeting modules and client portal.

#### 3.2 Quotation Module (Offertes)

The commercial front door and the counterpart of invoicing.

Functionality: build quotes from rate cards, service templates, and estimated hours; versioning of quotes during negotiation; sending as branded PDF with digital acceptance (a click-to-accept link, or signature via the client portal); quote statuses (draft → sent → accepted/rejected/expired) feeding the CRM pipeline; and one-click conversion of an accepted quote into a project with budget, rates, and milestones pre-filled.

Key integrations: client and rate data from the CRM; accepted quotes create projects for the SCRUM module and budgets for invoicing; quote documents are stored in document management.

#### 3.3 Contract & Agreement Module

Keeps track of what is formally agreed with each client, and when action is needed.

Functionality: a contract register per client with type (framework agreement, SOW, NDA, DPA), agreed rates and indexation clauses, start/end dates, notice periods, and renewal terms; automatic alerts ahead of renewal and notice deadlines; linking each project to the contract it falls under, so it is always clear on which terms work is performed; and rate-card management with effective dates, feeding quotation, time registration, and invoicing.

Key integrations: contract documents stored in document management; rates flow to quotation and invoicing; renewal alerts appear in notifications and dashboards.

### Delivery

#### 3.4 Time Registration Module

Employees log hours against projects (and optionally individual tasks). The design goal is minimal friction — logging a day should take under a minute.

Functionality: daily/weekly timesheet views with quick entry; timers that can be started from a task in the SCRUM board; categorization as billable or non-billable; weekly submission and (optional) approval flow; and reporting on utilization per person, realized hours vs. project budget, and write-offs.

Key integrations: approved billable hours become draft invoice lines in the invoicing module; logged hours appear on the project dashboard so budget burn is visible in real time.

#### 3.5 SCRUM Module — Task and Progress Tracking

Per-project agile boards to structure delivery work.

Functionality: a backlog and board (to do / in progress / review / done, configurable columns) per project; tasks with assignee, estimate, priority, labels, and due date; sprints with a defined scope and length, plus a simple burndown/velocity view; and epics or task groups for larger work packages. Not every project needs full SCRUM — the module also supports a plain kanban mode for simple engagements.

Key integrations: tasks link to time entries (log hours directly on a task), and completed tasks feed the activity timeline in the CRM and the status view in the client portal. The meeting agent can create tasks directly from action points.

#### 3.6 Meeting Notes Module (WYSIWYG Editor)

A structured place to prepare and capture meetings.

Functionality: a rich-text editor (headings, lists, tables, checkboxes, embedded images/files) with meeting templates (e.g. project status meeting, intake, retrospective); every note is linked to a client, project, and attendees; action items marked in a note can be converted to tasks in the SCRUM module with one click; and notes are searchable across the whole platform.

#### 3.7 Meeting Agent Module

An AI-supported layer on top of meetings. This is the most innovative module and is built after the notes module, which it extends.

Functionality: recording and live transcription of meetings (with explicit consent handling — a visible "recording" state and per-attendee consent, which matters under Dutch/EU privacy rules); automatic summary and minutes generated into the WYSIWYG editor after the meeting; detection of action points, decisions, and open questions, suggested as draft tasks for human confirmation; and an optional live assistant mode that tracks the agenda and signals when the conversation drifts from the planned topics or when time per agenda item runs out.

Design note: keep the human in control. The agent *suggests* notes and actions; a person confirms them before anything is written to the CRM or SCRUM module. This keeps data quality high and builds trust in the module.

### Financial

#### 3.8 Invoicing Module

Closes the loop from work to cash.

Functionality: draft invoices generated from approved billable hours (time & materials) or from fixed-fee project milestones defined in the accepted quote; invoice templates with company branding, correct VAT handling (21%, reverse-charge, exempt), and sequential numbering; sending as PDF by e-mail, with status tracking (draft → sent → paid → overdue) and automatic payment reminders; and credit notes. Export to the accounting package (e.g. Exact Online) or a UBL/e-invoice export so bookkeeping stays in sync.

Key integrations: client billing data from the CRM, hours from time registration, budgets and milestones from the quotation module, rates from the contract module; sent invoices are visible in the client portal.

### Information & Insight

#### 3.9 Document Management Module

Central storage of all client- and project-related files.

Functionality: a structured library per client and per project (contracts, proposals, deliverables, source files) with versioning, so there is always one current version and a visible history; access control per folder or document, aligned with the platform's permission model; full-text search across documents; and generated documents from other modules (quotes, invoices, meeting minutes) filed automatically in the right place. Selected documents or folders can be shared with the client via the client portal.

Key integrations: every module that produces or consumes files (quotation, contracts, invoicing, meeting notes) stores them here rather than keeping its own storage.

#### 3.10 Reporting & Dashboard Module

The management layer over all other modules — and, given the company's own BI background, a potential showcase of what we build for clients.

Functionality: dashboards for revenue per client and per service, utilization and billability per employee, project profitability (budget vs. logged hours vs. invoiced), pipeline and quote conversion, outstanding and overdue invoices, and contract renewals coming up; drill-down from every KPI to the underlying records; period comparisons and simple trend views; and role-based dashboards (management sees the whole business, a project owner sees their projects). A clean, queryable data layer underneath — so the same data can also be used in Power BI if deeper analysis is needed.

Key integrations: reads from all modules; writes nothing. This module is a consumer of the event stream and the shared data model.

#### 3.11 Client Portal Module

A restricted external view that turns the internal platform into a service differentiator.

Functionality: per-client login with access only to their own data; project status view (milestones, progress, recent activity) fed by the SCRUM module; shared documents and deliverables from document management, with optional client approval flows for deliverables; quotes presented for digital acceptance; invoices available for download with payment status; and a request/ticket form for new work or questions, which creates a lead or task internally.

Design note: the portal is a separate, hardened surface. It reuses the platform's data but has its own authentication, stricter permissions, and no access to internal-only records (time entries, margins, internal notes).

### 4. Future Module Candidates

Beyond the confirmed scope, these remain candidates for later phases: a **resource planning module** (forward-looking capacity planning, confronting planned vs. actual hours); a **knowledge base / wiki** reusing the WYSIWYG editor for internal documentation and standard approaches; an **expense module** (receipt capture, project linking, re-billing via invoicing); a **leave & absence module** feeding utilization reporting and resource planning; and an **e-mail integration module** linking correspondence to clients and projects so the activity timeline is complete.

Thanks to the architecture in Part III, adding any of these later requires no changes to the core or to existing modules.

## Part III — Architecture

### 5. The Core Problem the Architecture Solves

Two forces pull in opposite directions. Tight integration (everything references everything directly) gives rich linking but creates a tangle where no module can change without breaking others. Full separation (each module its own silo) gives independence but loses exactly the cross-links that make the platform worthwhile. The architecture resolves this with a **shared core that owns identity and relationships**, while modules own their own behavior and data.

### 6. Overall Shape: A Modular Monolith

For a small team, the recommended shape is a **modular monolith**: one application, one database, but with strict internal module boundaries.

This is deliberately *not* microservices. Separate services per module would mean distributed transactions, network calls for every cross-link, and operational overhead that a small team should not carry. A modular monolith gives the same architectural discipline (clear boundaries, explicit contracts) with none of the distribution cost — and because the boundaries are explicit, a module *could* still be split out later if ever needed.

The application is layered as follows, from bottom to top:

**Layer 1 — Platform Core.** Owns cross-cutting concerns: authentication and sessions, the permission model, the entity registry, the relationship service, the event bus, file storage, full-text search, notifications, and audit logging. The core has no business logic of its own.

**Layer 2 — Domain Modules.** The eleven modules from Part II. Each module owns its own database schema, business rules, and API. Modules never read or write another module's tables directly.

**Layer 3 — Application Shell.** The UI frame: navigation, global search, notification center, and the activity timelines. Modules register their screens and widgets into the shell.

**Layer 4 — External Surfaces.** The client portal frontend and any integrations (accounting export, e-mail, calendar). These talk to module APIs only, never to the database.

### 7. The Entity Registry: One Identity for Everything

The heart of the linking model. Every "thing" in the platform — a client, project, task, meeting, time entry, quote, invoice, contract, document, person — is an **entity** with:

- a globally unique ID (UUID),
- an entity type (`client`, `project`, `meeting`, `time_entry`, …),
- exactly one **owning module** (the CRM owns `client` and `project`; Time Registration owns `time_entry`; Meeting Notes owns `meeting`),
- a display name and URL, so any module can render a link to it without knowing its internals.

The core maintains this registry. When the SCRUM module creates a task, it registers the entity (`type=task, id=…, name="Build dashboard", url=/projects/…/tasks/…`). Other modules can now reference, link to, and display that task — knowing only its ID and what the registry exposes — without any dependency on the SCRUM module's internal data model.

Each entity type is declared in the owning module's **module manifest** (§11), so adding a new module with new entity types requires no change to the core: the core learns about new types from the manifest.

### 8. The Relationship Model: How Links Work

This answers the core requirement that modules work together — a meeting linked to a client, a time entry linked to a project. The platform uses **two complementary linking mechanisms**, each for a different kind of relationship.

#### 8.1 Structural relationships (typed, owned by modules)

Some relationships are part of a module's core logic and must be strongly enforced: a time entry *must* belong to a project and a person; an invoice line *must* reference a time entry or milestone; a task belongs to a project. These are ordinary typed foreign keys inside the owning module's schema, validated by that module's business rules. They are strict on purpose — you cannot save a time entry without a project.

Structural relationships are declared in the module manifest (e.g. Time Registration declares "time_entry → project (required), time_entry → task (optional)"), so the core knows the dependency graph between modules even though the data lives in module schemas.

#### 8.2 Contextual links (generic, owned by the core)

Many valuable links are not structural: a meeting relates to a client, a project, *and* the quote that was discussed; a document relates to a contract and a project; a task came out of a specific meeting. Hard-coding every such combination as foreign keys would mean endless schema changes and tight coupling.

Instead, the core provides a single **link service** with one polymorphic link table:

```
link(id, from_type, from_id, to_type, to_id, link_kind, created_by, created_at)
```

Examples: `(meeting:123 → client:45, kind=about)`, `(meeting:123 → quote:77, kind=discussed)`, `(task:512 → meeting:123, kind=originated_from)`. Any entity can be linked to any other entity, with an optional semantic kind. Because both ends are just registry IDs, linking a *new* entity type (say, a future "expense" entity) to existing ones requires zero changes to existing modules.

The link service enforces permissions on both ends (you can only create or see a link if you may see both entities) and emits events (`link.created`) so other features — timelines, search — react automatically.

**Rule of thumb:** if a module's business logic depends on the relationship, make it structural inside that module. If the relationship is context for humans, make it a contextual link in the core. A time entry's project is structural (invoicing depends on it); a meeting's related quote is contextual.

#### 8.3 What this enables directly

The activity timeline on a client page is a query on the core, not on eleven modules: "all entities linked (structurally or contextually) to client:45, ordered by time." The same mechanism powers the project page, the 360° view before a client meeting, and the client portal (filtered by external permissions). Global search results can show *related* entities for the same reason. No module had to be built with the timeline in mind — the links make it emergent.

### 9. The Event Bus: How Modules Cooperate Without Knowing Each Other

Links describe *state*; events describe *change*. Modules publish domain events to an in-process event bus, and subscribe to events they care about. Events carry entity IDs, never full payloads — subscribers fetch what they need via the owning module's API.

Illustrative flows:

- Time Registration publishes `timesheet.approved` → Invoicing picks up the billable entries as draft invoice lines. Time Registration has no knowledge that Invoicing exists.
- Quotation publishes `quote.accepted` → CRM updates the pipeline; a project scaffold is created; Document Management files the signed PDF.
- Meeting Agent publishes `meeting.action_points_suggested` → SCRUM offers them as draft tasks; on confirmation, SCRUM creates the task *and a contextual link* `task → meeting (originated_from)`.
- Contracts publishes `contract.expiring` → Notifications alerts the account owner; the dashboard flags it.

Events are persisted (an event log table) before being handled, which gives reliable processing, an audit trail, and replay if a subscriber was added later or failed. Because the bus is in-process in a monolith, this is simple infrastructure — a table and a dispatcher — not a message broker.

### 10. Data Architecture

**One PostgreSQL database, one schema per module, plus a `core` schema.** The `core` schema holds users, roles, permissions, the entity registry, the link table, the event log, files metadata, and audit records. Module schemas hold their own tables with structural foreign keys internal to the module; references to entities owned by *other* modules are stored as registry UUIDs (logically validated through the registry, not as cross-schema foreign keys — this keeps modules droppable/replaceable).

**Access pattern:** a module reads and writes only its own schema and calls the core's services (registry, links, events, files, permissions). When module A needs data from module B (Invoicing needs hour details from Time Registration), it calls B's internal API. This is the single most important discipline in the whole architecture; it is what keeps modules replaceable.

**Reporting is the one sanctioned exception.** The Reporting module gets a read-only path: a set of database views (or a light replicated reporting schema) published by each module as part of its contract — "this is my public, stable, queryable shape." Dashboards and Power BI read these views, never the raw tables. Modules can refactor internals freely as long as their published views stay stable.

**Files** live in object storage (EU-hosted), with metadata in the core; Document Management is the owning module for the document entity, but the storage service is core infrastructure that e.g. Meeting Notes also uses for embedded images.

### 11. The Module Manifest: The Extensibility Contract

Every module ships a manifest declaring:

1. **Identity** — module name, version.
2. **Owned entity types** — with display templates and URL patterns for the registry.
3. **Structural relationships** — which entities it references from other modules, required or optional.
4. **Published events** — with their meaning, and **subscribed events**.
5. **Permissions** — the roles/capabilities it introduces (e.g. `invoices.approve`).
6. **Navigation and widgets** — screens for the shell, widgets for timelines and dashboards (e.g. Time Registration contributes a "hours this week" widget to the project page).
7. **Reporting views** — the stable queryable views it publishes.
8. **Portal exposure** — which of its entities/views may surface in the client portal, and in what reduced form.

Adding a future module (expenses, resource planning) is then: write the module against core services, declare the manifest, done. Existing modules are untouched; the new entities are immediately linkable, searchable, timeline-visible, and permission-controlled because those capabilities live in the core.

### 12. Permissions in a Linked World

Linking makes permission design more important: a link must never leak data. The model:

- **Internal roles** (management, consultant, finance) grant module-level and capability-level access.
- **Record-level access** follows the client/project: if you are on project X's team, you see project X's tasks, meetings, documents, and hours. Record access is resolved through the registry — every entity can answer "which client/project do I belong to" via its structural relationships.
- **Traversal rule:** you see a link only if you may see both endpoints. A consultant may see that a meeting exists and is linked to a project, but not the linked contract if contracts are finance-only.
- **The client portal is a separate permission universe:** an explicit allow-list per entity type (defined in module manifests under portal exposure), always scoped to the client's own ID, evaluated on a hardened external API. Nothing is portal-visible by default.

### 13. Worked Example: One Meeting, End to End

To make the architecture concrete, the lifecycle of a single client meeting:

1. A consultant creates a meeting in Meeting Notes and links it (contextual links) to client:45 and project:88. The entity registry registers `meeting:123`; the links make it appear on the client's and project's timelines immediately.
2. The Meeting Agent records and transcribes; afterwards it writes the summary into the note and publishes `meeting.action_points_suggested`.
3. The consultant confirms two action points. SCRUM creates task:512 and task:513 under project:88 (structural), each with a contextual link back to meeting:123 (`originated_from`).
4. The consultant logs 1.5 hours; the time entry structurally references project:88 and, optionally, the meeting.
5. At month end, `timesheet.approved` fires; Invoicing drafts an invoice including those hours. The invoice structurally references the time entries and, through them, resolves to project:88 and client:45 for billing details and rates (rates fetched from the Contracts module's API).
6. On the client page, the timeline now shows: meeting held → tasks created → hours logged → invoice sent — assembled entirely by the core from registry entries, links, and events. No module was written to produce this view.

### 14. Technology Notes (Non-Binding)

The architecture is technology-agnostic, but a reference stack to anchor discussion: PostgreSQL (schemas per module, JSONB where flexible attributes help); a backend framework with good modular structure (e.g. .NET with projects per module, or Node/NestJS with its module system, or Django apps); a single-page frontend with a component library and module-based code splitting; object storage for files (EU region); and an outbox-table event dispatcher rather than an external broker. Authentication via a standard OIDC provider (also usable for portal logins with a separate tenant). These choices can be finalized as part of the build-vs-compose decision in §17.

### 15. Architectural Ground Rules (Summary)

1. Every entity has one owning module and a registry identity.
2. Modules touch only their own schema; everything else goes through core services or module APIs.
3. Business-critical relationships are structural inside the owning module; human context is a link in the core.
4. Modules communicate change through events, never direct calls to each other's internals.
5. Reporting reads published views only.
6. A link is visible only if both endpoints are.
7. New capability = new module + manifest; the core and existing modules stay untouched.

## Part IV — Roadmap and Decisions

### 16. Phasing Proposal

**Phase 1 — Foundation:** Core (auth, entity registry, link service, event bus, permissions) + CRM + Time registration. This already replaces spreadsheets and delivers immediate value — and building the registry, links, and events first means every subsequent module lands on finished rails.

**Phase 2 — Delivery:** SCRUM module + Meeting notes + Document management. Work execution and files move into the platform; document management comes early because nearly every later module stores files in it.

**Phase 3 — Commercial loop:** Quotation + Invoicing + Contract & agreement. The full cycle closes: quote → contract → project → hours → invoice, all on centrally managed rates.

**Phase 4 — Intelligence:** Reporting & dashboards + Meeting agent. AI and insight layers on top of the now-rich data.

**Phase 5 — External:** Client portal. Built last of the confirmed scope, because its value depends on the internal modules being filled (project status, documents, quotes, invoices) and it requires the most attention to security.

**Phase 6+ — Expansion:** Resource planning, knowledge base, expenses, leave, e-mail integration — based on actual need, added via the manifest mechanism without touching existing modules.

### 17. Open Questions

Decisions to make before development starts:

1. **Build vs. compose:** fully custom, or built on a low-code/existing foundation? This also settles the technology stack (§14).
2. **Hosting and data residency:** client data should stay in the EU; choose provider and region.
3. **Accounting integration:** which package to integrate with first (e.g. Exact Online), and export format (API vs. UBL).
4. **Meeting agent audio processing:** third-party transcription service or self-hosted models — a privacy/effort trade-off that needs a deliberate decision given client-confidential conversations.
5. **Portal authentication:** magic link, password, or SSO for client users.
6. **Ownership:** who internally owns the platform roadmap and priorities once it is live.
