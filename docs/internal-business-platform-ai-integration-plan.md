# Internal Business Platform — AI Integration Plan

**Status:** Concept / definition phase
**Date:** July 2026
**Companion to:** Master Document (vision, module scope, architecture)

---

## 1. Vision: AI as a Horizontal Layer, Not a Module

AI is not "module twelve." It is a capability of the platform itself — a layer that sits on top of the core and can reach into every module, the same way permissions and search do. This framing matters for two reasons.

First, it means every current and future module gets AI capabilities largely for free: the same mechanism that lets the AI assistant create a task today lets it file an expense the day the expense module ships, without any AI-specific work in that module beyond declaring its tools.

Second, it fits the existing architecture exactly. The master document already defines an entity registry (everything has an identity), module APIs (everything is reachable through a contract), an event bus (everything announces change), and a permission model (everything is access-controlled). These are precisely the ingredients an AI layer needs. The plan below is therefore mostly about *exposing* what the architecture already has — not about building parallel AI infrastructure.

AI shows up in three forms, in increasing order of autonomy:

1. **The AI Assistant** — a platform-wide chat that answers questions and executes actions on request ("generate a quote for client X", "what's open on the Chocolaterie project?").
2. **Embedded AI** — AI features inside module screens (draft this quote text, break this epic into tasks, summarize this document). Same machinery, different entry point.
3. **Proactive AI** — the platform notices things via the event stream and raises them ("project budget 85% consumed at 60% of timeline", "this quote has been unanswered for 14 days — draft a follow-up?").

The Meeting Agent module from the master document becomes the first specialized application of this layer rather than a standalone AI island.

## 2. The AI Assistant: Chat That Can Act

The assistant is a chat interface available everywhere in the platform (a sidebar or command bar), and it is **context-aware**: opened on a client page, it already knows which client is on screen; opened on a task, it knows the task, project, and client behind it.

What a working session looks like:

> **User:** Prepare a quote for the dashboard extension we discussed with De Chocolaterie last Tuesday.
> **Assistant:** Found the meeting of Tuesday 21 July linked to De Chocolaterie. The notes mention extending the KPI dashboard with purchasing analytics, estimated at 6–8 days. I've drafted quote Q-2026-041 based on the current rate card (consultancy rate from the framework agreement): 7 days × €___ = €___, validity 30 days. It's in draft — want to review it, or adjust the estimate first?

Behind that one exchange: search across meeting notes (retrieval), entity resolution (which client, which meeting), reading the contract module (rate card), and a tool call to the quotation module (create draft quote). The user reviewed nothing technical — but crucially, the result is a **draft**, presented for human review.

Core interaction principles:

**Read freely, write carefully.** Questions ("how many open tasks on project X?", "which invoices are overdue?") are answered directly. Actions that create or change data produce *drafts or proposals* that the user confirms — inline, with one click, showing exactly what will be written. Destructive or high-impact actions (sending an invoice, deleting anything, anything client-facing) always require explicit confirmation, and some can be configured to be unavailable to the assistant entirely.

**The assistant is the user.** It operates under the permissions of the person chatting — never more. A consultant's assistant cannot read finance-only contracts, exactly as the consultant cannot. This falls directly out of the architecture: tool calls go through the same module APIs with the same permission checks as UI actions.

**Everything is auditable.** Every tool call the assistant makes is logged in the existing audit trail, marked as AI-initiated-human-confirmed, with a reference to the conversation. "Who created this quote?" always has an answer.

**Show sources.** When the assistant answers from documents, notes, or records, it cites them with registry links, so a claim is always one click from its origin.

## 3. Architecture: The AI Layer

Four components, all built on existing core services.

### 3.1 Tool registry (the action surface)

Each module's **manifest gains a ninth section: AI tools.** A tool declaration is a function the AI may call: name, description in natural language, input schema, output schema, permission requirement, and a risk class (`read`, `write:draft`, `write:commit`, `restricted`).

Examples: CRM declares `search_clients`, `get_client_overview`, `create_lead`; Quotation declares `create_draft_quote`, `get_quote_status`; SCRUM declares `create_task`, `move_task`, `list_open_tasks`; Document Management declares `search_documents`, `get_document_summary`; Invoicing declares `create_draft_invoice` (`write:draft`) and `send_invoice` (`restricted` — arguably not exposed at all initially).

The AI orchestrator assembles the tool set per conversation from the manifests of the modules the *user* may access. A new module that ships tools in its manifest is instantly usable by the assistant — extensibility identical to how navigation and permissions already work. (This is the same pattern as the Model Context Protocol: modules act as tool servers, the orchestrator as the client.)

### 3.2 Orchestrator (the brain's harness)

A core service that: receives the user message plus UI context (current page entity); retrieves relevant knowledge (§3.3); sends conversation + tools to the LLM; executes returned tool calls through module APIs under the user's identity; loops until the model produces an answer; and streams the result with citations and any confirmation prompts. It also enforces the risk classes: `read` executes silently, `write:draft` executes and shows the draft, `write:commit` requires confirmation first, `restricted` is refused with a pointer to the manual flow.

The orchestrator is model-agnostic: the LLM is called through a provider interface so the underlying model (e.g. Claude via API, or an EU-hosted alternative) can be switched or routed per task — a small fast model for classification and autocomplete, a strong model for multi-step reasoning and drafting.

### 3.3 Knowledge layer (retrieval)

The assistant must ground its answers in the platform's actual data. Three retrieval paths, in order of preference:

1. **Structured lookups** — most questions ("open tasks on project X") are answered by tool calls on live data. Always current, always permission-checked. This is the default, not embeddings.
2. **Semantic search** — meeting notes, documents, and knowledge-base pages are chunked and embedded into a vector index (an extension of the core full-text search service, e.g. pgvector in the same PostgreSQL). Used for "what did we agree about X?" questions. Each chunk carries the entity ID and permission scope of its source, and results are filtered by the querying user's access *before* reaching the model.
3. **The link graph** — the registry and link table give the assistant a map of what relates to what, which is how "the meeting last Tuesday with De Chocolaterie" resolves to `meeting:123` without any AI-specific data structure.

### 3.4 Conversation store

Conversations are persisted per user (resumable, referenceable), and a conversation can be linked — via the ordinary link service — to the entities it touched, so a quote can show "created in this conversation."

## 4. Embedded AI: The Same Layer, In Place

The orchestrator and tools also power buttons and fields inside module screens, where a chat would be overkill. Planned embedded features per module:

- **Quotation:** draft scope/approach text from meeting notes and past similar quotes; suggest an estimate range based on comparable historical projects.
- **SCRUM:** break an epic or a meeting outcome into concrete tasks with estimates; draft acceptance criteria; weekly sprint summary generated from board activity.
- **Meeting Notes / Agent:** as specified in the master document — transcription, minutes, action-point extraction — now explicitly implemented on this shared layer.
- **CRM:** summarize a client's full timeline before a meeting ("prep me for De Chocolaterie"); draft follow-up e-mails in the company's tone.
- **Invoicing:** generate clear invoice-line descriptions from the underlying time entries; draft polite payment reminders escalating in firmness.
- **Document Management:** on-upload summarization and auto-tagging; "ask this document" for long contracts; suggested filing location.
- **Contracts:** extract key terms (dates, notice periods, rates) from an uploaded contract PDF into structured fields — human-verified before saving.
- **Reporting:** natural-language querying ("show billability per person this quarter") translated to the published reporting views; anomaly annotations on dashboards.
- **Client Portal (later, cautiously):** a client-facing assistant answering only from portal-visible data — separate, stricter tool set; internal-only knowledge is architecturally unreachable, not just filtered.

## 5. Proactive AI: Watching the Event Stream

The event bus makes proactivity cheap: an **insight service** subscribes to domain events, evaluates rules and patterns, and creates *suggestions* — notifications with a proposed action attached, executed only on user approval.

Launch set: project budget consumption outpacing timeline; quotes unanswered past a threshold (proposed action: drafted follow-up); invoices overdue (proposed: drafted reminder); contract renewal windows opening (proposed: prep summary of the engagement); hours logged but unsubmitted at week end; tasks stuck in a column beyond N days.

Proactive AI never acts on its own. It prepares, proposes, and waits. This keeps trust high while still removing the "I forgot to chase that quote" class of losses.

## 6. Trust, Safety, and Privacy

This section is deliberately part of the plan and not an afterthought — the platform contains client-confidential and financial data.

**Human in the loop by risk class.** The `read` / `write:draft` / `write:commit` / `restricted` classification is enforced by the orchestrator, not left to the model's judgment. Sending anything to a client is never below `write:commit`.

**Permissions are inherited, never widened.** The AI layer has no service account with broad rights; every call runs as the requesting user.

**Prompt injection awareness.** Documents, e-mails, and meeting transcripts are *untrusted input* — an uploaded PDF could contain text that tries to instruct the model. Mitigations: retrieved content is clearly delimited as data; instructions found inside content are never executed as actions without the same confirmation flow; and high-risk tools remain confirmation-gated regardless of what any content says.

**Data processing boundaries.** LLM calls go to a provider with EU data residency or contractual guarantees (no training on our data, defined retention — e.g. zero-retention API terms); the vector index and conversation store live in our own database. Which provider, and whether meeting audio is processed by a third party or self-hosted, is a deliberate decision (open question in the master document) to be made with clients' confidentiality obligations in mind — and reflected in our own processing agreements with clients.

**Transparency to clients.** Where AI touches client-facing output (quotes, reminders), a human has reviewed and sent it; the portal assistant (if built) is clearly labeled as AI.

**Evaluation before expansion.** Each new tool or embedded feature ships with a small test set (representative prompts and expected behavior) so quality is measured, not assumed. Tools start in `write:draft` and are only promoted after a track record.

## 7. Phasing the AI Integration

AI phases run alongside the module phases from the master document; each step uses only modules that exist by then.

**AI Phase 1 (with platform Phase 1–2):** Foundations — tool declarations in the manifest format, orchestrator v1, provider interface. Assistant launches read-only + drafts: questions across CRM, time, tasks, notes; task creation and note summarization as first write tools. Semantic search over notes and documents.

**AI Phase 2 (with platform Phase 3):** The commercial assistant — draft quotes from meetings and rate cards, invoice-line generation, payment-reminder drafts, contract term extraction. This is where the "generate a quote from a chat message" scenario becomes real.

**AI Phase 3 (with platform Phase 4):** Meeting Agent built on the shared layer (transcription, minutes, action extraction, live agenda tracking), natural-language reporting, and the proactive insight service on the event bus.

**AI Phase 4 (with platform Phase 5+):** Cautious externalization — portal assistant with an isolated tool set — and expansion of tool autonomy where the track record justifies it (e.g. auto-filing documents without confirmation).

**A note on sequencing:** the tool registry and orchestrator should be designed in platform Phase 1 even though the assistant ships later — retrofitting tool declarations onto finished modules is exactly the kind of rework the manifest mechanism exists to prevent. Since the platform's AI layer, its manifest/tool pattern, and the consultancy's own service offering (AI-driven process improvement) reinforce each other, this layer is also a candidate internal showcase for client work.

## 8. Open Questions

1. **LLM provider and residency:** which provider(s), under which data terms; one model or routed per task.
2. **Meeting audio:** third-party transcription vs. self-hosted — the single most privacy-sensitive choice in the plan.
3. **Cost model:** expected token spend per user per month; budget alerts; whether heavy features (transcription) are metered internally.
4. **Assistant surface:** sidebar chat, command palette, or both; keyboard-first vs. mouse-first.
5. **How far to take autonomy:** the plan starts conservative (drafts + confirmation). Decide the criteria for promoting a tool to autonomous execution.
6. **Client communication:** what we tell clients about AI processing of their data, and what our processing agreements need to say.
