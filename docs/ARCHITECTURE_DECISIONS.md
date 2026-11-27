# Architecture decisions — overview

A digest for someone joining the project. **The source of truth is [decision-log.md](decision-log.md)**
(full reasoning, dated) and the phase briefs; this page tells you what was chosen, why, and what was
turned down, so you do not re-litigate it. Where the log and this page disagree, the log wins — fix this page.

Format: **Decision** · why · rejected · revisit if. IDs (D1…, G3, P1…, Q1…, C1…, N1…) are the log's own.

---

## 1. Foundations

| ID | Decision | Why | Rejected | Revisit if |
|---|---|---|---|---|
| D1 | Fully custom build | The connected-records vision (registry + links + events) *is* the product; composing SaaS tools would weaken it. Also a showcase for client work. | Low-code foundation, SaaS composition | Solo velocity can't sustain it |
| D2 | Solo, AI-assisted | One builder: strictly sequential phases, per-module MVPs, dogfooding as the quality mechanism. | Team / agency | — |
| D3 | TypeScript end-to-end: NestJS + React/Vite, Postgres schema-per-module + `core`, Drizzle, pnpm + Turborepo | Nest's modules/DI/events/guards map 1:1 onto the architecture; one language; Drizzle stays SQL-close (suits published reporting views). | Django (+admin, but second language); Prisma (further from SQL) | — |
| D4 → actual | Hosting: **Netcup VPS**, Docker Compose + Caddy (D4 said Hetzner; production went to Netcup — Hetzner is only a possible off-site backup target) | Cheap, EU, one monolith to deploy. Self-managed ops accepted. | Managed PaaS | Ops burden eats build time |
| D5 | Zitadel Cloud (EU) for OIDC | Never hand-roll auth; portal tenant model built in. | Self-hosted Keycloak/Zitadel, Auth0/Clerk, ad-hoc email+password | — |
| D7/G0 | Walking skeleton first, throwaway demo module, gate before real modules | Prove registry/link/event/manifest before building eleven modules on it. Passed 2026-07-27; the design held, four implementation lessons recorded (see CLAUDE.md pitfalls). | — | — |
| — | Boundaries enforced by tooling, not review: dependency-cruiser (`pnpm boundaries`) + ESLint `no-restricted-imports` | "Modules replaceable" only holds if breaking it fails the build. A module may import another's `*.service.ts` / `*.module.ts`, never its schema/controller/manifest. | Convention + code review | — |
| — | Contract checks as scripts across package boundaries: `pnpm routes`, `widgets`, `migrations`, `bundle`, `live` | Each guards a gap no single package's tests can see (stored `urlPath` with no web route; declared widget with no component; hand-written SQL drifting from the schema; Excalidraw leaking into the entry chunk). | Unit tests in one package | — |
| — | **Audit log is append-only** (triggers block UPDATE/DELETE/TRUNCATE, no admin exception; test helper disables and re-arms the guard) | The entries most worth altering record what an administrator did. UPDATE matters more than DELETE: an altered row reads as truth. | Relaxing the trigger for tests | Retention needed → a visible migration that drops, prunes and restores the triggers |
| — | Boot-time integrity guarantees (`core/db/integrity.service`): the API verifies DB invariants at start and refuses to run if they are missing | Failures should surface at deploy (health check → rollback), not for a user. | Silent degradation | — |

## 2. AI layer

| ID | Decision | Why | Rejected | Revisit if |
|---|---|---|---|---|
| D6 | Vercel AI SDK as the provider interface, **direct provider keys**, vendor SDKs only in `core/llm` | One-line model swap without a US middleman processor in the data path; orchestrator owns context, not the provider. | OpenRouter in production | EU-resident fallback needed by a client DPA |
| D6a | Default provider: **paid Google Gemini** (`MODEL_STRONG`, `MODEL_FAST`, `MODEL_EMBEDDING`) | No Anthropic key available; free tier trains on prompts, paid tier doesn't. Switching = env var. | Free Gemini tier | An Anthropic account becomes available (judged stronger at tool use) |
| — | Tools are declared in module manifests with a `riskClass` (`read`, `write:draft`, `write:commit`, `restricted`); the orchestrator enforces it under the *user's* identity | AI is horizontal: each module gets assistant support by declaring, not by editing the chat. Cheap inline, costly to retrofit. | Per-feature bespoke AI code | O7: criteria for promoting draft → autonomous |
| — | Tools that reach a client (`sales_send_quote`, `billing_send_invoice`) are `restricted` | A person decides what goes in front of a client. | — | — |
| 2026-10-14 | Assistant may **create** portal custom content (`portal_add_page`, `write:draft`, created *disabled*) but never publish it; takes no bypass secret. *(`portal_page` as a registry entity with a chat card is not merged yet — branch `feat/portal-pages-as-records`, see HANDOVER_STATUS §0)* | Automates the fiddly part (slug, SSRF-safe URL, portal address exists); publishing stays human. Credentials don't belong in retained chat. The portal declares **no other** aiTools so a client's words are never read as our instructions — a test pins that. | Publishing from chat (the `artefact-publiceren` skill owns that pipeline with its own credentials) | A second tool, especially a read, is somebody's explicit decision |
| 2026-10-14 | `MODEL_TRANSCRIBE`: env-only, **Gemini-only**, checked before a bot joins, never read from `platform_settings` | G3 accepts a US processor receiving raw audio on the condition that *no additional* processor sees content. A dropdown must not be able to withdraw that. Empty notes came from the `fast` slot pointing at a model that can't take audio. | Letting the `fast` slot transcribe | — |
| 2026-10-25 | **`agent` role**: a service account holds only `AGENT_CAPABILITIES` (default `scrum.tasks.read,docs.read`; unset ≠ empty). Admin-only names refused; typos stop boot; signing in never creates an agent; assistant and MCP share `AiToolRegistry` | A member-level service account was offered 45 tools incl. invoices and transcripts. Positive list: new capabilities reach agents only when named. | Per-record scoping (not built: agents see *all* tasks/docs) | Agent needs something the list can't express → per-account setting |
| 2026-10-26 | Paperclip (agent platform) runs on its **own Netcup VPS** (not the hub host), connects via `POST /api/mcp` as Zitadel service user `paperclip-agent` with role `agent`; writes not granted yet | Its prompts, tools and model provider are not ours (see agent role above). Ops details: `docs/deploy-runbook.md` and HANDOVER_STATUS. | — | Grant `scrum.tasks.write` after watching agent behaviour |
| — | Help is searchable and assistant-readable (`help_search`, `help_read`); in-process keyword search | Reference pages generated from manifests can't drift; guides guarded by `help.content.spec`. | Embeddings now | 100+ pages or vocabulary mismatch → `EmbeddingService` over the same sections |

## 3. Meetings

| ID | Decision | Why | Rejected |
|---|---|---|---|
| G3 | **Recall.ai** hosted bot (EU region, Frankfurt); transcription on Gemini; audio never persisted; per-attendee consent, one refusal blocks capture; `MeetingCaptureProvider` interface | Delivers a separate audio stream per participant with roster identity: speaker attribution is transport, not inference — no diarisation, no biometric voiceprints (GDPR Art. 9). | MeetingBaas (mixed mono stream, scraped names); self-hosted Attendee (maintenance treadmill; kept as escape hatch for clients whose DPA forbids sub-processors); Skribby (no compliance evidence); Teams transcript via Graph (post-hoc only); own Teams bot (.NET, Azure registration, €150–300/mo) |
| G3 risk | Browser dual-stream capture kept as fallback when a client tenant blocks external bots | Microsoft's external-bot policies are outside our control. | — |
| 2026-09-12 | **Attendance carries visibility**: joining a call links you to the note. Matching by exact address, else unique active display name; ambiguous or departed → unlinked. `restricted` notes stay outside this (explicit grants in `note_viewers`) | Attendee = who was in the room; viewer = a decision somebody made. A wrong match is silent. | Author-must-share-each-person |

## 4. Documents (D8, 2026-09-09)

Document bytes live in a **separate SharePoint site** in the existing M365 tenant; metadata, extracted text,
embeddings, links, per-artefact visibility and the portal stay in the platform.

- **Separate site, not a folder**: `Sites.Selected` grants at site level; a folder would have exposed HR and bookkeeping in `FinseraHub`.
- **App-only client credentials**, one `write` grant. Delegated OAuth rejected: IdP is Zitadel (`Actor.userId` is not an Entra id) and two non-interactive writers (invoice/quote PDF rendering) hold no user token.
- Library layout: `Clients/<client>/<project>/`, `_Algemeen/`, `_Exports/`; nothing is looked up by path, the item id is the pointer.
- **`FinseraHub` is never touched** (no grant, no bulk import); good documents are moved by hand once.
- **Not a `StorageService` driver**: documents get `DocumentStore` (a SharePoint file has an item id, cTag, web URL and history). `StorageService` still serves whiteboard/note images and portal logos.
- Indexing is **manual** (no webhooks/delta/cron); staleness is judged on `cTag`, never `eTag`, and shown on search results.
- Portal bytes keep streaming through the API; clients never receive a `sharepoint.com` URL.
- Accepted consequences: two permission systems ("Open in Word" bypasses `docs.read`); sharing links from SharePoint UI leave no audit trail here (mitigate with tenant policy); document bytes leave the backup drill; Graph joins the invoicing path (failure falls back to local storage).
- Deferred with trigger: Graph-managed access (`/invite`, `/permissions`) when somebody is hired or a client contract requires segregation.

## 5. Client portal

| ID | Decision | Why / rejected |
|---|---|---|
| G4 | Zitadel, separate project/app; sign-in method is Zitadel configuration | Not a hand-built magic link (token generation, expiry, replay, rate limits are security-critical code for a login used a few times a year). |
| G6 | `PORTAL_ROLE_CHECK=off` — portal skips the `portal_client` role because Zitadel emitted no role claims. **Opt-out by exact value `'off'`**; warns every boot; the `internal` role gate is *not* relaxed | Invitation row is the gate that answers "whose data". Intended to expire; production state not verified in this handover. |
| P1 | Sessions are **cookies issued by the API** (server-side OIDC; `portal.sessions`) | A report link is a plain navigation with no Bearer header. `PortalIdentityService` is the old guard with a new entry point. |
| P2 | One login callback on `portal.finsera.nl`; one-time, one-host, 60-second hand-off ticket | Zitadel redirect URIs are exact-match; per-client callbacks would break silently at onboarding. |
| P3 | Reports **reverse-proxied** by the API with Vercel's bypass header; CSP; path checked in both directions | Not redirected (leaks origin), not iframed. Vercel proxy secret only goes to `*.vercel.app` hosts, parsed not string-matched. |
| P4 | Wildcard DNS + Caddy **on-demand TLS** gated by `/api/portal-host/check`; site address is a host-less `https://` catch-all | A `*.` host in a Caddy site address makes Caddy *manage* a wildcard cert (needs DNS-01) and took `hub.finsera.nl` down on 2026-09-03. Verify config by running the image against `.test` names and reading the managed-domains log line. |
| P5 | Same Zitadel project; staff may open any client portal **read-only as the client**, clients only their own host. Reads use `@CurrentViewer()`, writes `@CurrentVisitor()`; a spec asserts it per route | Staff session is a second kind of session, not a flag. The host only checks the client the session already named. |
| 2026-09-03 | Logout ends the identity-provider session too (end_session from discovery, `client_id` instead of `id_token_hint`, post-logout URI on the login host) | A logout that doesn't log out is worse than none. Reverses the Phase 8 call. Same bug fixed in the internal app. |
| 2026-09-09 | Identity is one seam (`ZitadelTokens`) but `AuthGuard` and `PortalIdentityService` stay separate types | The different return types (Actor vs client/staff viewer) are the safety property. |
| 2026-09-09 | Portal logins are real entities; visibility **per artefact** (`everyone`/`restricted` + grants, *no row = everyone*); invoices/quotes all-or-nothing per person; enforced in `portal.projection.ts`, not controllers | Half an invoice list has a total that doesn't add up. The proxy answers `next()`, never 403. |
| 2026-09-04 | Portal front page answers "what needs you", no dashboard; tabs hide themselves; no per-user preferences; logos PNG/JPEG only | A dashboard would start telling clients about the business; SVG can carry script on a page holding a session. |
| Phase 9 | Tickets: events carry ids and subject, never the message body; Insights rule `ticket_waiting_on_us` (2 days / 7 urgent) resolves itself; formatting via `@platform/ticket-markdown` (closed set of five node types, React escapes leaves, no sanitiser, no `dangerouslySetInnerHTML`) | A client's prose must not reach the bus. A sanitiser is a list of known-dangerous things; a closed node set can't express them. |
| 2026-09-14 | Invitation link on our own domain (`portal.finsera.nl/api/portal-auth/activate`, leaves a `psx=<slug>` cookie), landing on the client's own subdomain | Deliverability; Zitadel's Default Redirect URI is the fallback. |

## 6. Commercial modules

- Quotes (Q1–Q6): no rate-card module; no click-to-accept (would be the first unauthenticated public endpoint); sent quotes immutable, revisions make v2; `Q2026-0001` allocated on send, separate counter from invoices (invoice sequence cannot have gaps); expiry derived, never stored; accepting *offers* a project.
- Contracts (C1–C5): rate cards fill the project rate, invoicing never looks up rates by date; a contract is a record with a document attached; notice windows derived on read; five contract types incl. `dpa` (makes O8 answerable per client); `sales_draft_contract_terms` is `write:draft` and must not infer unstated terms.
- Money is integer cents; Finsera bills time & materials, fixed fee and retainer, mixed per project; prospects are Clients with a status (no lead entity).

## 7. Notifications (2026-10-17, N1–N12 accepted)

A notification is a way an Inbox item reaches you, **never a second queue** (narrowly reverses "don't build a notifications system"). One `core.notifications` record per person; tiers Now (push) / Today (morning brief) / Quiet; Web Push with VAPID via a push-only, non-caching service worker; lock screens show who + title, never body or amount; working hours Mon–Fri 08:30–18:30 Europe/Amsterdam; never the actor, collapsed by subject, capped, deduplicated; hub in English, client mail in Dutch. Dispatcher fixed first (N0): unsubscribed events were never marked, and new subscribers got full history — subscribers now have a start point. Email waits on **G8** (mail provider; recommendation Graph `sendMail`, no new processor).

## 8. Delivery and operations

- **Branch model**: `main` is where work lands, `production` is what runs. Deploy = fast-forward `production` onto `main` and push; GitHub Action SSHes in (restricted key), `deploy/update.sh` rebuilds and **rolls back if unhealthy**. Rollback = reset `production` and push.
- **Migrations run at API boot** (`runMigrations` before traffic); no separate production migration step. `assertNothingSkipped` guards the timestamp high-water-mark trap.
- Config that must exist is enumerated in `deploy/docker-compose.yml` as well as `deploy/.env` (a variable compose doesn't list never reaches the container — how `PORTAL_PAGE_KEY` once went missing). Unsafe defaults are opt-out by exact value.
- Uploads outage (2026-09-14): `/app/storage` is created owned by `node` in `Dockerfile.api`, and `StorageService` probes a subdirectory at boot so a bad volume fails the deploy instead of a user.
- Backups: nightly dumps + document tarball, restore drill into a scratch DB (never over production), quarterly. Up to 24 h data loss accepted.
- Hub notifications/Help in English; time-derived states never stored; nothing should change state while nobody is looking.
