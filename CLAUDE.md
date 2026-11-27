# Finsera Platform — working agreement for Claude Code

Internal business platform for Finsera (Dutch BI consultancy, 2–4 people). Live at hub.finsera.nl;
client portal on `<slug>.finsera.nl`. Solo-built by Tomas, AI-assisted. Read `docs/HANDOVER_STATUS.md`
first for current state, `docs/ARCHITECTURE_DECISIONS.md` before changing anything structural.

## Architecture in one screen

Modular monolith, three layers in `apps/api/src`:

- `core/` (Layer 1): entity registry, link service, outbox event bus + dispatcher, permissions, audit
  log, files/storage, Graph (SharePoint) client, auth (Zitadel), `llm/` (the only place AI vendors are
  touched). No business logic.
- `modules/` (Layer 2): `crm time scrum sales billing docs meetings reporting insights portal
  whiteboard help`. Each owns one Postgres schema, a `*.manifest.ts`, `*.service.ts` (its published API),
  `*.controller.ts`, `*.schema.ts` (drizzle), `*.module.ts`.
- `shell/` (Layer 3): assistant endpoint, MCP endpoint, search, timeline, notifications, build info.

A **manifest** declares a module's entities (with `urlPattern`), events, capabilities, navigation,
widgets, reporting views, `portalExposure` and `aiTools` (with `riskClass`). `ManifestRegistry` validates
them at boot and fails startup on duplicates. The assistant (`core/llm/orchestrator`), MCP (`POST /api/mcp`)
and Help all derive from manifests — nothing is wired by hand.

Other apps/packages: `apps/web` (React + Vite SPA; one web module per backend module under
`src/modules/`, composed in `src/modules/index.ts`), `apps/portal` (separate client SPA, served by the API
on client hosts), `packages/contracts` (shared zod: manifest, DTOs, events), `packages/config` (tsconfig),
`packages/board-doc|note-doc|ticket-markdown` (document formats). `deploy/` = production stack
(Caddy + API + Postgres, backup/restore scripts). `docs/` = briefs, decision log, runbook.

Stack: TypeScript, NestJS, Drizzle + Postgres (pgvector), React/Vite, pnpm + Turborepo, Zitadel Cloud EU
(OIDC), Vercel AI SDK with direct keys (default provider paid Google Gemini), Recall.ai (meeting bot),
Microsoft Graph (documents live in a dedicated SharePoint site), Web Push (VAPID). Host: Netcup VPS
(not Hetzner) behind Caddy.

## Commands (run from repo root; pnpm lives in `~/.local/bin`)

```sh
pnpm install
docker compose up -d                  # local Postgres (pgvector); cp .env.example .env first
pnpm dev                              # api :3001, web :5173 (proxies /api)
pnpm --filter @platform/portal dev    # portal :5174; client hosts are <slug>.localhost:5174
pnpm lint | pnpm typecheck | pnpm build | pnpm test
pnpm boundaries                       # dependency-cruiser rules (CI-enforced)
pnpm routes | pnpm widgets | pnpm migrations | pnpm bundle   # cross-package contract checks
pnpm -w run verify                    # everything CI runs
pnpm --filter @platform/api db:generate | db:migrate | db:check
pnpm live                             # does hub.finsera.nl run my local commit?
```

Run one API spec: `pnpm --filter @platform/api test <path-to-spec>` (pnpm appends it to `vitest run`).
CI = Postgres `pgvector/pgvector:pg16`, Node 24 (engines: `>=22`). Preview configs: `.claude/launch.json`.

## Conventions

- Files: `<module>.manifest|service|controller|schema|module.ts`; specs sit beside source as `*.spec.ts`.
  Web modules export a `WebModule` from `modules/<name>/index.ts` (routes, `chatWidgets`, `widgets`).
- Capabilities are `<module>.<area>.<action>` (e.g. `time.entries.write_own`); `adminOnly` where needed.
  Roles: administrator, member (holds every non-admin capability), agent (explicit allowlist only).
- Money is integer cents (EUR). Invoice numbers have no gaps; quote numbers `Q2026-0001` are separate.
- Anything derived from time (expiry, notice windows, days waiting) is computed on read, never stored.
- Hub UI and Help are English; client-facing portal and client mail are Dutch.
- Event payloads carry ids and scalars only, never bodies, amounts or client prose.
- Every screen needs a Help guide (`apps/api/src/modules/help/content/<module>/`, front matter incl.
  `paths`, bump `updated`); `help.content.spec.ts` fails the build otherwise. Manifest changes show up in
  generated Help reference automatically.
- Code comments explain *why* and name the failure that motivated the code. Match that style.
- Commits: one imperative/descriptive sentence, no type prefix, explains the user-visible effect.
  Branch → PR → `main`; deploying is a separate step (see `.claude/skills/deploy`).
- Phone tier: one breakpoint `40rem`, in `apps/web/src/phone.css` and `PHONE` in
  `shell/useMediaQuery.ts` — keep in sync. Touch rules key on `(hover: none)`/`(pointer: coarse)`.
  UI direction is *refine, not redesign*: petrol `#1f5f4f`, warm neutrals, Plus Jakarta Sans.

## NEVER

1. Import an AI vendor SDK outside `core/llm`.
2. Import across layers/modules except `*.service.ts` / `*.module.ts` of another module. Core never imports
   modules, shell never imports modules, no cycles. (`pnpm boundaries` fails CI.)
3. Call `vitest` directly, or run tests against a database whose name does not end in `_test`.
4. Read out, print, log or commit secrets: `.env`, `deploy/.env*`, tokens, keys, client secrets. Example
   files list variable *names* only. Don't paste credentials into prompts or tool arguments.
5. Run `docker compose down -v` on the server, regenerate the production VAPID pair, or restore over production.
6. Push to `production`, merge a PR, switch `gh` accounts, or commit — unless Tomas asked for it in this
   conversation. Deploys are outward-facing.
7. UPDATE/DELETE/TRUNCATE `core.audit_log` or drop its triggers outside a visible migration.
8. Let client-written text reach the event bus or an AI tool. The portal module declares exactly one
   `aiTools` entry (`portal_add_page`, creates disabled); a second one is a decision, not a drift.
9. Merge `AuthGuard` (internal, provisions colleagues) with `PortalIdentityService` (clients, provisions
   nobody), or relax the `internal` role gate in `UserService.resolveFromClaims`.
10. Hand-edit applied migrations or `drizzle/meta/_journal.json`, or `drizzle-kit generate` a drop+create
    in one go (it prompts interactively — split into two migrations).
11. Touch the `FinseraHub` SharePoint site, or hand a client a `sharepoint.com` URL (D8).
12. Reopen a decided item (D1–D8, G3, G4, P1–P5, N1–N12) without being asked; read `docs/decision-log.md` first.
13. Hardcode a transcription model or let `MODEL_TRANSCRIBE` follow a settings dropdown: Gemini only.
14. Add a screen or capability without its Help guide, manifest entry and spec.

## Pitfalls and workarounds

- **API tests share one DB** (`platform_test`) and truncate it. Two concurrent sessions produce fake
  failures ("Both entities must exist in the registry", "Owner must be an existing user"). Isolate with
  `TEST_DATABASE_URL='postgres://platform:platform@localhost:5432/platform_<name>_test'`. Check
  `pgrep -f vitest` before killing — it is probably another session's. `verify` has the same problem.
- Never skip `scripts/setup-test-db.mjs` (the `test` script runs it) — bare vitest gives dozens of schema failures.
- Zod: never `instanceof` across the CJS api / ESM contracts boundary — structural checks only.
- First-touch writes (JIT user provisioning) must be idempotent; `/me` and `/navigation` race.
- Postgres UNIQUE treats NULLs as distinct — link dedup is enforced in code.
- Modules use `select().from()`; the core drizzle client is typed on the core schema only.
- `core.users` and `portal.users` are both `users`: joining needs drizzle `alias()`.
- Migrations run at API boot (no separate step). Drizzle applies by timestamp against a high-water mark:
  a migration numbered after one not yet merged is silently skipped (`migrator.ts` asserts this). With
  parallel branches, prefer a boot-time reconcile step over a migration for derived rows.
- Hand-written migrations are checked against the schema only by `pnpm migrations` — run it.
- Dispatcher delivery is at-least-once: handlers must be idempotent; new subscribers need a start point.
- Hotfixes sometimes land straight on `production`. Before any deploy: `git fetch origin && git rev-list
  --left-right --count origin/production...origin/main` — left must be 0.
- `gh`'s active account (`finsera-dev`) is read-only on the repo; git pushes work through another credential.
- Vercel proxy secret goes only to hosts ending `.vercel.app` (parse the URL, don't string-match).
- Docker-published ports bypass ufw; Paperclip is bound to 127.0.0.1.
- Dev noise that is not a bug: HMR 500s mid-edit; Vite reporting an API restart as 500; both seen when two
  sessions edit the repo at once.
- Port 5174 for the portal, 3001 for the API (`autoPort`), 5173 for web.

## Recent architecture decisions (details in `docs/ARCHITECTURE_DECISIONS.md`)

- 2026-10-25 `agent` role + `AGENT_CAPABILITIES` allowlist; MCP endpoint shares `AiToolRegistry` with the assistant.
- 2026-10-17 Notifications deliver the Inbox (one record per person, three tiers, no bodies on lock screens).
- 2026-10-14 Assistant may create portal custom content, never publish it. (`portal_page` as a registry entity with
  a chat card is **not merged** — it is on branch `feat/portal-pages-as-records`; see HANDOVER §0.)
- 2026-11-22 `MODEL_TRANSCRIBE` is env-only and Gemini-only; checked before a bot joins a call.
- 2026-11-22/23 Artefacts get a signed identity and own time-out; custom content pages are editable.
- 2026-09-09 D8: documents live in SharePoint (app-only, `Sites.Selected`); portal bytes still stream via API.
