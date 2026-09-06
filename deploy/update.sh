#!/bin/bash
# Deploy whatever the production branch now points at, and put the old one back if it
# does not come up.
#
#   deploy/update.sh              # fetch, rebuild, verify, roll back on failure
#   deploy/update.sh --no-rollback   # leave the broken state in place to inspect it
#
# Runs on the server. Invoked by hand, or over SSH by .github/workflows/deploy.yml.
#
# The rollback is the point. A deploy that fails halfway leaves a business without its
# platform until somebody notices, and "somebody" is one person who may be in a meeting.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f deploy/docker-compose.yml --env-file deploy/.env)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
ROLLBACK=true
[[ "${1:-}" == "--no-rollback" ]] && ROLLBACK=false

previous=$(git rev-parse HEAD)
echo "[deploy] on $BRANCH at ${previous:0:8}"

git fetch -q origin "$BRANCH"
target=$(git rev-parse "origin/$BRANCH")
if [[ "$previous" == "$target" ]]; then
  echo "[deploy] already at ${target:0:8} — nothing to do"
  exit 0
fi

echo "[deploy] ${previous:0:8} → ${target:0:8}"
git log --oneline "$previous..$target" | sed 's/^/[deploy]   /'
git reset -q --hard "$target"

# ── health ──────────────────────────────────────────────────
# Asks the API rather than docker: a container can be up while the app inside it is
# failing every request, and it is the requests that matter.
healthy() {
  local tries=${1:-30}
  for ((i = 0; i < tries; i++)); do
    if curl -fsS -m 5 http://127.0.0.1/api/core/health >/dev/null 2>&1; then return 0; fi
    sleep 5
  done
  return 1
}

# ── which build this is ─────────────────────────────────────
# Derived from the checkout, never from a file somebody edits: a version that is written
# down has to be kept in step, and the one moment it is wrong is the moment somebody is
# using it to decide whether a fix is live. `rev-list --count` rises by one per commit
# and costs nothing to maintain.
#
# Exported rather than passed, because compose reads them for two services in two
# different ways — a build arg for the SPA, whose values Vite inlines at build time, and
# an environment variable for the API, which can read its own at runtime.
stamp() {
  export BUILD_VERSION="$(git rev-list --count HEAD)"
  export BUILD_COMMIT="$(git rev-parse --short HEAD)"
  export BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[deploy] build $BUILD_VERSION ($BUILD_COMMIT)"
}

build_and_start() {
  # Stamped here rather than once at the top: the rollback path builds a second time from a
  # different commit, and it must not label the old code with the new commit's number.
  stamp
  "${COMPOSE[@]}" up -d --build
}

if build_and_start && healthy; then
  echo "[deploy] healthy at ${target:0:8}"
  "${COMPOSE[@]}" ps --format "table {{.Service}}\t{{.State}}\t{{.Status}}"
  exit 0
fi

echo "[deploy] FAILED at ${target:0:8}" >&2
if ! $ROLLBACK; then
  echo "[deploy] --no-rollback: leaving it broken for inspection" >&2
  exit 1
fi

echo "[deploy] rolling back to ${previous:0:8}" >&2
git reset -q --hard "$previous"
if build_and_start && healthy; then
  echo "[deploy] rolled back and healthy at ${previous:0:8}" >&2
else
  # Both failed, so the cause is probably not the code — a full disk, a dead database,
  # an expired credential. Say so plainly instead of implying the new commit was bad.
  echo "[deploy] ROLLBACK ALSO UNHEALTHY — the problem is likely not this commit" >&2
fi
exit 1
