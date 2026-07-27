# Finsera Platform

Internal business platform — a modular monolith with a shared core (entity registry, links, events, permissions) and an AI layer riding on module manifests.

**Read first:** [docs/phase0-spec.md](docs/phase0-spec.md) (current build target) · [docs/build-roadmap.md](docs/build-roadmap.md) · [docs/decision-log.md](docs/decision-log.md)

## Structure

```
apps/api        NestJS backend — core/ (Layer 1), modules/ (Layer 2), shell/ (Layer 3)
apps/web        React + Vite SPA (application shell + module screens)
packages/contracts  Shared zod schemas + TS types (manifest, DTOs, events)
packages/config     Shared tsconfig presets
docs/           Planning documents (master doc, AI plan, roadmap, decisions, specs)
```

## Development

Requires Node 22+, Docker, and pnpm (`corepack enable pnpm --install-directory ~/.local/bin`;
make sure `~/.local/bin` is on your `PATH`).

```sh
docker compose up -d     # local Postgres 16
cp .env.example .env     # fill in secrets
pnpm install
pnpm dev                 # api on :3001, web on :5173 (proxies /api)
```

Checks: `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm boundaries` (architectural rules) ·
`pnpm -w run verify` (all of them — what CI runs).

## Ground rules (enforced, not aspirational)

- Modules touch only their own DB schema; everything else via core services or module APIs.
- Modules never import other modules; core never imports modules (`pnpm boundaries` fails CI).
- Every module ships a manifest — including its AI-tools section — as it is built.
- No AI vendor SDK outside `core/llm`.
