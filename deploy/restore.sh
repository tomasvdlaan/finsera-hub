#!/bin/bash
# Restore drill and real recovery.
#
#   deploy/restore.sh                     # latest backup → scratch DB, verify, report
#   deploy/restore.sh <stamp> <database>  # a specific backup into a named database
#
# Defaults to a scratch database on purpose: a restore script whose default overwrites
# production is a foot-gun waiting for a bad night.
#
# Verifies BOTH halves. Uploaded files live outside Postgres, so a database-only restore
# would hand back document rows pointing at files that do not exist — a backup that looks
# fine until someone clicks download.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"

# Dev and production keep their backups in different stacks; use whichever is running.
if docker compose -f "$ROOT/docker-compose.yml" ps --status running --services 2>/dev/null | grep -q backup; then
  COMPOSE=(docker compose -f "$ROOT/docker-compose.yml")
  PGUSER_DEFAULT=platform
else
  COMPOSE=(docker compose -f "$HERE/docker-compose.yml" --env-file "$HERE/.env")
  PGUSER_DEFAULT="${POSTGRES_USER:-platform}"
fi

STAMP="${1:-}"
TARGET_DB="${2:-restore_check}"

if [[ -z "$STAMP" ]]; then
  STAMP=$("${COMPOSE[@]}" exec -T backup bash -c \
    'ls -1t /backups/*.sql.gz 2>/dev/null | head -1 | sed -E "s/.*-([0-9]{8}T[0-9]{6}Z)\.sql\.gz/\1/"')
  [[ -n "$STAMP" ]] || { echo "No backups found" >&2; exit 1; }
fi
echo "Restoring backup $STAMP into database '$TARGET_DB'…"

# ── database ────────────────────────────────────────────────
"${COMPOSE[@]}" exec -T postgres psql -U "$PGUSER_DEFAULT" -d postgres \
  -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" -c "CREATE DATABASE \"$TARGET_DB\";" >/dev/null

"${COMPOSE[@]}" exec -T backup bash -c "gunzip -c /backups/*-${STAMP}.sql.gz" \
  | "${COMPOSE[@]}" exec -T postgres psql -U "$PGUSER_DEFAULT" -d "$TARGET_DB" -q 2>/dev/null

# Counted dynamically: a backup is an old snapshot, so it may predate a table that
# exists today. Naming tables statically would make restoring an older backup fail on
# the report rather than on anything that matters.
echo
echo "Row counts:"
"${COMPOSE[@]}" exec -T postgres psql -U "$PGUSER_DEFAULT" -d "$TARGET_DB" -q -c "
  DO \$\$
  DECLARE t text; n bigint;
  BEGIN
    CREATE TEMP TABLE counts(name text, rows bigint) ON COMMIT DROP;
    FOREACH t IN ARRAY ARRAY['crm.clients','crm.projects','time.entries',
                             'docs.documents','docs.versions','docs.chunks',
                             'core.entities','core.links'] LOOP
      IF to_regclass(t) IS NOT NULL THEN
        EXECUTE format('SELECT count(*) FROM %s', t) INTO n;
        INSERT INTO counts VALUES (t, n);
      ELSE
        INSERT INTO counts VALUES (t, NULL);
      END IF;
    END LOOP;
  END \$\$;
  SELECT name AS table, coalesce(rows::text, '(not in this backup)') AS rows FROM counts ORDER BY name;"

# ── files ───────────────────────────────────────────────────
# The real test: every storage key the restored database references must exist in the
# restored file archive. Anything missing is a document that would 404 on download.
echo
echo "Verifying uploaded files…"
# Existence is checked first, in its own statement: Postgres parses a whole query before
# running it, so even an unreachable reference to a missing table is a parse error. A
# backup taken before documents existed is valid and simply has nothing to verify.
HAS_DOCS=$("${COMPOSE[@]}" exec -T postgres psql -U "$PGUSER_DEFAULT" -d "$TARGET_DB" -tA \
  -c "SELECT to_regclass('docs.versions') IS NOT NULL;" | tr -d '\r')

if [[ "$HAS_DOCS" == "t" ]]; then
  KEYS=$("${COMPOSE[@]}" exec -T postgres psql -U "$PGUSER_DEFAULT" -d "$TARGET_DB" -tA \
    -c "SELECT storage_key FROM docs.versions;" | tr -d '\r')
else
  KEYS=""
fi

if [[ -z "$KEYS" ]]; then
  echo "  no documents in this backup — nothing to verify"
  echo
  echo "Restore drill passed."
  exit 0
fi

ARCHIVE_LIST=$("${COMPOSE[@]}" exec -T backup bash -c \
  "test -f /backups/files-${STAMP}.tar.gz && tar -tzf /backups/files-${STAMP}.tar.gz" || true)
if [[ -z "$ARCHIVE_LIST" ]]; then
  echo "  MISSING: no file archive for $STAMP — the database restored, the documents did not" >&2
  exit 1
fi

missing=0
total=0
while IFS= read -r key; do
  [[ -n "$key" ]] || continue
  total=$((total + 1))
  if ! grep -qx "./$key" <<<"$ARCHIVE_LIST"; then
    echo "  MISSING: $key" >&2
    missing=$((missing + 1))
  fi
done <<<"$KEYS"

if (( missing > 0 )); then
  echo "  $missing of $total file(s) missing — this backup would restore broken documents" >&2
  exit 1
fi
echo "  all $total file(s) present in the archive"
echo
echo "Restore drill passed."
