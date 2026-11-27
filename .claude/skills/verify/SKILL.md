---
name: verify
description: Run the full pre-merge check (lint, typecheck, build, tests, boundaries, route/widget/migration/bundle contracts) without colliding with other sessions on the shared test database.
---

# Verify a change

CI runs `pnpm -w run verify`. Locally the API test suite uses one shared database (`platform_test`) and
truncates it, so two concurrent runs produce misleading failures ("Both entities must exist in the registry",
"Owner must be an existing user"). Those are not regressions.

## Steps

1. **Is another session testing?** `pgrep -f vitest` (do not kill what you did not start).
2. **Pick a private database** whose name ends in `_test` (the guard in `apps/api/src/test/db.ts` refuses
   anything else):
   ```sh
   export TEST_DATABASE_URL='postgres://platform:platform@localhost:5432/platform_<yourname>_test'
   ```
   `pnpm test` creates and migrates it via `scripts/setup-test-db.mjs`. Never run bare `vitest`: skipping
   the setup step causes dozens of spurious schema failures.
3. **Fast, database-free checks first:** `pnpm lint && pnpm typecheck && pnpm boundaries && pnpm routes && pnpm widgets && pnpm bundle`
   (`pnpm bundle` inspects the built output, so run `pnpm build` before it).
4. **Migrations vs schema:** `pnpm migrations` (builds a scratch DB from the SQL and diffs it against the Drizzle schema).
5. **Tests:** `pnpm test`; for one spec `pnpm --filter @platform/api test <path-to-spec>`.
6. **Everything in one go:** `pnpm -w run verify` (prefix with `TEST_DATABASE_URL` as above).
7. If a failure mentions truncated/missing seed rows, re-run in isolation before debugging code.

Known flake: `portal-tickets.service.spec.ts` "orders a client's own list by what happened last" (no
tiebreaker on `last_activity_at`). Re-run once; if it passes, report it as the known flake, not as green-by-luck.

Report exactly which commands ran and their results; do not claim "all green" for steps you skipped.
