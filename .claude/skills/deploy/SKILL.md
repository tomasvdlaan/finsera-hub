---
name: deploy
description: Ship main to production at hub.finsera.nl — divergence check, fast-forward push of the production branch, health verification. Only when the user explicitly asks to deploy.
disable-model-invocation: true
---

# Deploy to production

Deploying = fast-forwarding the `production` branch onto `main` and pushing. `.github/workflows/deploy.yml`
SSHes to the server, `deploy/update.sh` rebuilds (~2.5 min) and **rolls itself back if the API is unhealthy**.
Migrations run at API boot; there is no separate migration step.

Never push `production`, merge PRs or switch `gh` accounts without the user saying so in this conversation.

## Steps

1. **Is the work on `main`?** If it is on a branch, open a PR first. `gh`'s default account (`finsera-dev`)
   is read-only here: `gh pr create` fails with "must be a collaborator". Ask before running
   `gh auth switch --user tomasvdlaan`, and switch back afterwards.
2. **Has production diverged?** Hotfixes sometimes go straight to `production`:
   `git fetch origin && git rev-list --left-right --count origin/production...origin/main`
   The left number must be 0. If not, a fast-forward is impossible and deploying `main` would roll the hotfix
   back: merge `origin/production` into the release branch (via PR) first, and tell the user what it contains.
3. **What will ship?** `git log --oneline origin/production..origin/main` — `main` can hold merged but
   undeployed work. Show the list and say so if it is more than the PR at hand. Get a go-ahead.
4. **Verify locally:** `pnpm -w run verify` (see the `verify` skill for isolating the test database).
5. **Push (fast-forward only, never `--force`):** `git push origin origin/main:production`
6. **Wait ~3 minutes, then verify:** `curl -s https://hub.finsera.nl/api/core/health` reports `commit` and
   `version`; healthy implies migrations ran. `pnpm live` compares the live commit with the local branch.
   If the Action shows "server rolled itself back", the previous commit is still serving: read the log tail
   in the Action summary before retrying.

## Notes

- Env-only change: `deploy/update.sh` no-ops when the commit hasn't moved, so on the server run
  `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d api` (see `docs/deploy-runbook.md`).
  A variable must also be listed in `deploy/docker-compose.yml` or it never reaches the container.
- Never `docker compose down -v` on the server (destroys volumes). Never regenerate the VAPID pair.
- Rollback = reset `production` to an older commit and push; the branch is the record of what is live.
- Caddy changes: verify by running the image against placeholder `.test` names and reading the
  "managed domains" log line (a `*.` host in a site address once took TLS down for everyone).
