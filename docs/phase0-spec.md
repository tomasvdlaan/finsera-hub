# Phase 0 Technical Spec — Walking Skeleton

**Companion to:** Master Document · AI Integration Plan · Build Roadmap · Decision Log
**Builds on decisions:** D3 (NestJS + React, Postgres + Drizzle, pnpm monorepo) · D4 (Hetzner) · D5 (Zitadel Cloud EU) · D6 (Vercel AI SDK, direct keys)
**Status:** Draft — pending green-light (Decision O1)
**Date:** July 2026

---

## 1. Purpose and exit criteria

Phase 0 proves the architecture with the thinnest possible vertical slice, using a **throwaway demo module**, before any real module is built. It exists to answer one question cheaply: *is the core (registry + links + events + permissions + manifest) right to build eleven modules on?*

**Gate G0 — done when all of the following hold, on the deployed Hetzner environment (not just locally):**

1. You can log in via Zitadel (OIDC) and reach the app shell.
2. Creating a demo item registers an entity in the core registry inside the same transaction.
3. That item can be contextually linked to another entity via the core link service, and the link is visible only when the caller may see both endpoints (the permission call path runs, even if the v0 policy is simple).
4. Creating the item writes an event to the outbox; the dispatcher delivers it; a second, independent subscriber reacts; delivery is recorded per subscriber; a failed handler retries and dead-letters after N attempts.
5. A core timeline query ("everything linked to entity X, ordered by time") renders in the shell — assembled by the core alone, with no demo-module code in the query path.
6. Every mutation above appears in the audit log with actor and timestamp.
7. The demo module's **manifest** — including an **AI-tools section** — validates at bootstrap; a duplicate entity type or event name fails startup loudly.
8. The **LLM provider interface** compiles and passes a smoke test (one real `generateText` call with one tool invocation via the AI SDK) — no assistant UI.
9. `git push` → CI green → one command deploys to Hetzner. Postgres backup runs nightly and a restore has been tested once.

When G0 passes, the demo module is deleted and Phase 1 (CRM) starts on proven rails. If the core feels wrong at any point, fix it *here* — that is the whole point of the phase.

**Out of scope for Phase 0 (deliberately):** file storage service (table stub only), full-text/semantic search, notifications, record-level permissions, the assistant UI, conversation store, reporting views, any real business entity.

---

## 2. Repository layout

pnpm workspace monorepo, Turborepo for task running.

```
platform/
├── apps/
│   ├── api/                    # NestJS backend
│   │   └── src/
│   │       ├── core/           # Layer 1 — platform core (no business logic)
│   │       │   ├── registry/     # entity registry service
│   │       │   ├── links/        # link service
│   │       │   ├── events/       # outbox + dispatcher
│   │       │   ├── permissions/  # permission service (v0)
│   │       │   ├── audit/        # audit service
│   │       │   ├── manifest/     # manifest schema + bootstrap registry
│   │       │   ├── llm/          # provider interface (AI SDK wrapper)
│   │       │   └── db/           # drizzle client, schema barrel, migrations
│   │       ├── modules/        # Layer 2 — domain modules
│   │       │   └── demo/         # throwaway; deleted after G0
│   │       │       ├── demo.module.ts
│   │       │       ├── demo.manifest.ts
│   │       │       ├── demo.service.ts     # the module's internal API
│   │       │       ├── demo.controller.ts  # its HTTP surface
│   │       │       └── demo.schema.ts      # drizzle tables, schema "demo"
│   │       └── shell/          # Layer 3 backend bits: timeline query, nav aggregation
│   └── web/                    # React + Vite SPA
│       └── src/
│           ├── shell/          # nav, auth, layout, timeline widget
│           ├── modules/
│           │   └── demo/       # screens; registers routes/nav into the shell
│           └── lib/            # api client, auth (oidc pkce)
├── packages/
│   ├── contracts/              # shared zod schemas + TS types (manifest, API DTOs, events)
│   └── config/                 # shared tsconfig / eslint
├── docker-compose.yml          # local: postgres only
├── deploy/                     # Dockerfile(s), compose for Hetzner, Caddyfile
└── turbo.json
```

**Boundary rules, enforced from day one** (ESLint `no-restricted-imports` + a dependency-cruiser check in CI):

- `modules/*` may import from `core/*` and `packages/contracts`, never from another module's folder.
- `core/*` never imports from `modules/*` — the core learns about modules only through manifests at bootstrap.
- Cross-module calls (none in Phase 0; Invoicing→Time later) go through the other module's exported Nest service token, declared as a dependency in the manifest.

---

## 3. Database: `core` schema

One PostgreSQL 16 database. Schemas: `core` + one per module (`demo` in Phase 0). Drizzle `pgSchema()` per schema; migrations via `drizzle-kit`, committed to the repo. **IDs are UUIDv7** (time-ordered → index-friendly, sortable) generated in the app.

```sql
-- ── identity ────────────────────────────────────────────────
CREATE TABLE core.users (
  id            uuid PRIMARY KEY,                 -- internal id
  oidc_subject  text NOT NULL UNIQUE,             -- Zitadel sub claim
  email         text NOT NULL,
  display_name  text NOT NULL,
  role          text NOT NULL DEFAULT 'member',   -- v0: 'admin' | 'member'
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Users are provisioned on first login (JIT from the OIDC token).

-- ── entity registry ─────────────────────────────────────────
CREATE TABLE core.entities (
  id            uuid PRIMARY KEY,                 -- THE id; module tables reuse it as their PK
  entity_type   text NOT NULL,                    -- 'demo_item', later 'client', 'project', …
  owning_module text NOT NULL,                    -- 'demo', later 'crm', …
  display_name  text NOT NULL,                    -- denormalized for cheap link rendering
  url_path      text NOT NULL,                    -- '/demo/items/<id>'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz                       -- soft delete; links to deleted entities render struck-through
);
CREATE INDEX ON core.entities (entity_type);

-- ── links (contextual) ──────────────────────────────────────
CREATE TABLE core.links (
  id          uuid PRIMARY KEY,
  from_type   text NOT NULL,
  from_id     uuid NOT NULL REFERENCES core.entities(id),
  to_type     text NOT NULL,
  to_id       uuid NOT NULL REFERENCES core.entities(id),
  link_kind   text,                               -- 'about' | 'discussed' | 'originated_from' | null
  created_by  uuid NOT NULL REFERENCES core.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_id, to_id, link_kind)
);
CREATE INDEX ON core.links (from_id);
CREATE INDEX ON core.links (to_id);
-- Links are stored one-directional, queried bidirectionally by the timeline.

-- ── event outbox ────────────────────────────────────────────
CREATE TABLE core.events (
  id           uuid PRIMARY KEY,
  event_name   text NOT NULL,                     -- 'demo_item.created'
  entity_type  text NOT NULL,                     -- primary subject of the event
  entity_id    uuid NOT NULL,
  actor_id     uuid,                              -- who caused it (null = system)
  payload      jsonb NOT NULL DEFAULT '{}',       -- IDs and scalars ONLY — never full records
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.event_deliveries (               -- at-least-once, per subscriber
  event_id     uuid NOT NULL REFERENCES core.events(id),
  subscriber   text NOT NULL,                     -- '<module>.<handlerName>'
  status       text NOT NULL DEFAULT 'pending',   -- pending | done | failed | dead
  attempts     int  NOT NULL DEFAULT 0,
  last_error   text,
  processed_at timestamptz,
  PRIMARY KEY (event_id, subscriber)
);
CREATE INDEX ON core.event_deliveries (status) WHERE status IN ('pending','failed');

-- ── audit ───────────────────────────────────────────────────
CREATE TABLE core.audit_log (
  id              uuid PRIMARY KEY,
  actor_id        uuid REFERENCES core.users(id), -- null = system/dispatcher
  action          text NOT NULL,                  -- 'demo_item.create', 'link.create', …
  entity_type     text NOT NULL,
  entity_id       uuid NOT NULL,
  detail          jsonb NOT NULL DEFAULT '{}',    -- changed fields (before/after), kept small
  ai_initiated    boolean NOT NULL DEFAULT false, -- true when a tool call did this (Phase 2+)
  conversation_id uuid,                           -- future FK to conversation store
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON core.audit_log (entity_id, created_at);

-- ── files (STUB — table only, no service until Phase 3) ─────
CREATE TABLE core.files (
  id           uuid PRIMARY KEY,
  storage_key  text NOT NULL,                     -- S3 object key (Hetzner object storage)
  filename     text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL,
  uploaded_by  uuid REFERENCES core.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

**Demo module schema** (throwaway, illustrates the pattern every module follows):

```sql
CREATE TABLE demo.items (
  id          uuid PRIMARY KEY,     -- SAME uuid as core.entities.id — the registry id IS the row id
  title       text NOT NULL,
  note        text,
  created_by  uuid NOT NULL,        -- registry uuid of a core user; NOT a cross-schema FK
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**The invariant that makes the registry work:** a module row and its registry entry share the same UUID and are written **in the same transaction**. `RegistryService.register()` and `EventBus.publish()` both accept the caller's transaction handle. No entity exists without a registry entry; no event fires for an uncommitted change.

---

## 4. Core services (Layer 1)

All are Nest injectables in `core/`, no HTTP surface of their own except the timeline. Signatures are the contract Phase 1+ modules will code against — *this is the most important section of the spec.*

```ts
// core/registry
interface RegistryService {
  register(tx: Tx, e: { id: string; entityType: string; displayName: string; urlPath: string }): Promise<void>;
  updateDisplay(tx: Tx, id: string, patch: { displayName?: string; urlPath?: string }): Promise<void>;
  softDelete(tx: Tx, id: string): Promise<void>;
  resolve(ids: string[]): Promise<EntityRef[]>;    // batch: id → {type, name, url, deleted}
}

// core/links
interface LinkService {
  create(actor: Actor, l: { fromId: string; toId: string; kind?: string }): Promise<Link>;
  remove(actor: Actor, linkId: string): Promise<void>;
  listFor(actor: Actor, entityId: string): Promise<Link[]>;  // both directions, permission-filtered
}
// create() and listFor() call PermissionService.canSee(actor, id) on BOTH endpoints.
// create() publishes 'link.created'. This call path is sacred — it exists from Phase 0.

// core/events
interface EventBus {
  publish(tx: Tx, e: { name: string; entityType: string; entityId: string;
                       actorId?: string; payload?: Record<string, Json> }): Promise<void>;
}
// Handlers are NOT registered here in code — they are declared in manifests (§5).

// core/permissions  (v0 policy, full call path)
interface PermissionService {
  canSee(actor: Actor, entityId: string): Promise<boolean>;   // v0: any active user → true
  can(actor: Actor, capability: string): Promise<boolean>;    // v0: role check ('admin' | 'member')
}
// v0 is trivially permissive on records, but EVERY read path already routes through it,
// so tightening to record-level access in later phases changes policy, not plumbing.

// core/audit
interface AuditService {
  record(tx: Tx, a: { actorId?: string; action: string; entityType: string; entityId: string;
                      detail?: Json; aiInitiated?: boolean; conversationId?: string }): Promise<void>;
}

// shell/timeline  (the §13 payoff — a core query, no module code)
interface TimelineService {
  for(actor: Actor, entityId: string): Promise<TimelineEntry[]>;
  // = events where entity_id ∈ ({entityId} ∪ linked ids visible to actor), joined to registry
  //   for display names/urls, ordered by created_at desc. Exposed at GET /api/core/timeline/:entityId.
}
```

### Event dispatcher

In-process, DB-backed, no broker — per Master §9.

- **Publish:** insert into `core.events` within the caller's tx. An `AFTER COMMIT` hook nudges the dispatcher (fast path); a **5s poll** over pending `event_deliveries` is the reliable path (catches nudge misses and restarts).
- **Fan-out:** on first sight of an event, the dispatcher creates one `event_deliveries` row per manifest-declared subscriber of that event name, then invokes handlers.
- **Delivery:** at-least-once. Handlers must be **idempotent** (documented, and the demo module's handler demonstrates the pattern: check-before-write). Failure → `attempts+1`, exponential backoff via poll cycles; after **5 attempts → status `dead`** and an error log. A `GET /api/core/events/dead` admin endpoint lists dead letters (replay = flip status to `pending`).
- **Ordering:** per-event-fan-out is unordered across subscribers; a single subscriber processes events in `created_at` order per poll batch. Good enough for a monolith; revisit only if a real need appears.

---

## 5. The module manifest

A typed object every module exports; validated with zod at bootstrap; collected by `ManifestRegistry`, which fails startup on duplicate entity types, event names, tool names, or unknown event subscriptions. This is the extensibility contract from Master §11 **plus the ninth section from the AI plan**.

```ts
// packages/contracts/manifest.ts
export interface ModuleManifest {
  name: string;                     // 'demo'
  version: string;                  // '0.1.0'

  entities: Array<{                 // owned entity types
    type: string;                   // 'demo_item'
    displayTemplate: string;        // '{title}'
    urlPattern: string;             // '/demo/items/:id'
  }>;

  structuralRefs: Array<{           // typed refs to OTHER modules' entities
    from: string; toType: string; required: boolean;   // none in demo
  }>;

  publishes: Array<{ name: string; description: string }>;
  subscribes: Array<{ event: string; handler: string }>;    // handler = injectable method key

  permissions: Array<{ capability: string; description: string }>;

  navigation: Array<{ label: string; path: string; icon?: string }>;
  widgets: Array<{ slot: 'timeline' | 'dashboard' | 'entity-page'; component: string }>;

  reportingViews: Array<{ view: string; description: string }>;   // empty until Phase 6 discipline starts (Phase 1)

  portalExposure: Array<{ entityType: string; fields: string[] }>; // empty by default — nothing portal-visible

  aiTools: Array<{                  // ── section 9: the AI surface ──
    name: string;                   // 'demo_create_item'
    description: string;            // natural language, written for the model
    inputSchema: z.ZodType;         // zod — doubles as runtime validation
    outputSchema: z.ZodType;
    permission: string;             // capability required of the CALLING USER
    riskClass: 'read' | 'write:draft' | 'write:commit' | 'restricted';
    handler: string;                // injectable method key on the module's service
  }>;
}
```

**Demo manifest (abridged):** owns `demo_item`; publishes `demo_item.created`; **subscribes to its own event** with a handler that writes a "reaction" audit entry (proving fan-out + idempotency without needing a second real module); navigation contributes one shell entry; `aiTools`: `demo_list_items` (`read`) and `demo_create_item` (`write:draft`) — wired to the provider-interface smoke test, not to any UI.

In Phase 0 the orchestrator does not exist; the manifest's `aiTools` are validated, listed by a debug endpoint (`GET /api/core/ai/tools` — admin only), and exercised once by the smoke test (§7). That is deliberately all.

---

## 6. Auth (Zitadel OIDC)

- **Web:** OIDC Authorization Code + PKCE (a small oidc client lib), tokens in memory + silent renew. No custom login screens — Zitadel hosts them.
- **API:** Nest guard validates the JWT (JWKS from Zitadel), maps `sub` → `core.users` (JIT-provision on first login, default role `member`; first user flipped to `admin` manually in DB).
- **Actor:** every request carries `Actor { userId, role }` (Nest request context) — the same object the permission service, link service, and later the AI orchestrator consume. **There is no system/service actor for user-facing paths**; only the event dispatcher runs as `actor = null` (system), and only for deliveries.

---

## 7. LLM provider interface

Thin wrapper in `core/llm` over the **Vercel AI SDK** (D6). Purpose in Phase 0: fix the contract and prove the plumbing — nothing more.

```ts
// core/llm
type ModelRole = 'strong' | 'fast';               // routing starts trivial: both → same Claude model

interface LlmService {
  generate(opts: {
    role: ModelRole;
    system: string;
    messages: CoreMessage[];                       // AI SDK message type (supports images/PDF parts later)
    tools?: Record<string, CoreTool>;              // AI SDK tool defs, built FROM manifest aiTools
    maxSteps?: number;
  }): Promise<{ text: string; toolCalls: ToolCallRecord[]; usage: TokenUsage }>;
}
// Config: MODEL_STRONG / MODEL_FAST env vars (provider:model strings), ANTHROPIC_API_KEY.
// Swapping models or adding a provider = env change + one registry line. No module ever
// imports an AI vendor SDK directly — this service is the only door. Token usage is logged
// per call from day one (feeds the cost model, decision O6).
```

**Smoke test (CI-run, skipped when no API key):** builds the AI SDK tool set from the demo manifest's `aiTools`, asks the model to create a demo item titled "hello from the skeleton", asserts the tool call was made, executed under a test actor, risk class respected (`write:draft` → item created with a `draft` marker in `detail`), and audit row has `ai_initiated = true`. This one test exercises manifest→tools→execution→audit — the entire AI-layer spine in miniature.

---

## 8. Web shell (Layer 3)

- **Shell:** left nav (assembled from module registrations), header with user menu, main outlet. shadcn/ui + Tailwind. Light polish only — Phase 0 is not a design phase.
- **Module registration (frontend mirror of the manifest):** each web module exports `{ routes, navItems }`; the shell composes them. Demo module ships two screens: item list + item detail.
- **Item detail screen proves the payoff:** shows the item, a "link to…" picker (calls the core link API), and the **timeline widget** (`GET /api/core/timeline/:id`) rendering registry-resolved names as links — the §13 worked example, in miniature, on screen.
- **API client:** typed fetch wrapper; DTO types imported from `packages/contracts`.

---

## 9. Deployment & operations

- **Local:** `docker compose up` (Postgres 16) + `pnpm dev` (api + web via Turbo).
- **Hetzner:** one CX-class VPS. Docker Compose stack: `caddy` (TLS + static web + reverse proxy `/api`), `api` (Node 22 distroless image), `postgres:16` with a mounted volume. Deploy = GitHub Actions builds images → pushes to registry → SSH `docker compose pull && up -d`. One command, rollback = previous tag.
- **Backups:** nightly `pg_dump` to Hetzner object storage (S3), 30-day retention; **one restore drill before G0 sign-off** (it's in the checklist because untested backups aren't backups).
- **Migrations:** `drizzle-kit` migrations run automatically on api startup, guarded by a Postgres advisory lock (safe with one instance; still correct if a second is ever added).
- **Secrets:** `.env` on the server, never in the repo. `ANTHROPIC_API_KEY`, `DATABASE_URL`, Zitadel client config.
- **Observability (v0):** structured JSON logs (pino) shipped nowhere yet — `docker logs` is fine for one box; dead-letter endpoint (§4) is the only ops UI.

---

## 10. Build order & sizing

Sequential steps, each ending in something runnable. Sizing assumes the D2 builder model (solo, AI-assisted).

| # | Step | Proves | ~Effort |
|---|---|---|---|
| 1 | Monorepo scaffold, CI, lint/boundary rules, local compose | toolchain | 1–2 d |
| 2 | Zitadel setup, OIDC in web + API guard, JIT user provisioning | auth end-to-end | 2–3 d |
| 3 | `core` schema + migrations; Registry/Audit/Permission services + tests | identity spine | 2–3 d |
| 4 | Link service (+ permission path both ends) + tests | linking | 1–2 d |
| 5 | Event outbox + dispatcher + deliveries + dead-letter + tests | events | 2–3 d |
| 6 | Manifest schema + bootstrap registry + validation failures | extensibility contract | 1–2 d |
| 7 | Demo module (schema, service, controller, manifest, self-subscriber) | the pattern modules will copy | 2 d |
| 8 | Web shell + demo screens + timeline widget | Layer 3 + §13 payoff | 3–4 d |
| 9 | LLM provider interface + smoke test | AI spine | 1–2 d |
| 10 | Hetzner deploy, backups + restore drill, G0 walkthrough | production reality | 2–3 d |

**Total: ~17–26 focused days** — consistent with the roadmap's 3–5 week M sizing for Phase 0.

---

## 11. What Phase 0 deliberately gets wrong (and why that's fine)

- **Permissions are permissive.** The *call path* is what's being proven; policy hardens per phase. Tightening later touches `PermissionService` internals only.
- **The demo module is throwaway.** Its job is to be the reference implementation Phase 1 copies; it is deleted at G0. Resist making it useful.
- **No search, files, notifications.** Each arrives with the phase that first needs it (files → Phase 3, search → Phase 3, notifications → Phase 5b renewals at the latest).
- **One box, one instance.** A modular monolith on a VPS is the right amount of ops for one builder. Scaling stories wait for a scaling problem.

---

## 12. Sign-off

Green-lighting this spec closes **decision O1** (append to the decision log). G0's checklist (§1) is the exit; the outcome — including anything the skeleton forced you to change about the core design — is recorded in the log's gate table. Then: delete the demo module, write the CRM requirement brief, begin Phase 1.
