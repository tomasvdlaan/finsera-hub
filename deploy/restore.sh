#!/bin/bash
# Restore a backup into a database — used for the G0 restore drill and for real recovery.
#
#   deploy/restore.sh                      # restore latest into a scratch DB and verify
#   deploy/restore.sh <file> <database>    # restore a specific dump into a named DB
#
# Defaults to a scratch database on purpose: a restore script whose default overwrites
# production is a foot-gun waiting for a bad night.
set -euo pipefail

COMPOSE=(docker compose -f "$(dirname "$0")/docker-compose.yml" --env-file "$(dirname "$0")/.env")

FILE="${1:-}"
TARGET_DB="${2:-restore_check}"

if [[ -z "$FILE" ]]; then
  FILE=$("${COMPOSE[@]}" exec -T backup bash -c 'ls -1t /backups/*.sql.gz 2>/dev/null | head -1')
  [[ -n "$FILE" ]] || { echo "No backups found in /backups" >&2; exit 1; }
  echo "Using latest backup: $FILE"
fi

echo "Restoring into database '$TARGET_DB'…"
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-platform}" -d postgres \
  -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" -c "CREATE DATABASE \"$TARGET_DB\";"

"${COMPOSE[@]}" exec -T backup bash -c "gunzip -c '$FILE'" \
  | "${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-platform}" -d "$TARGET_DB" -q

echo
echo "Row counts in restored database:"
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-platform}" -d "$TARGET_DB" -c "
  SELECT 'entities' AS table, count(*) FROM core.entities
  UNION ALL SELECT 'links', count(*) FROM core.links
  UNION ALL SELECT 'events', count(*) FROM core.events
  UNION ALL SELECT 'users', count(*) FROM core.users
  UNION ALL SELECT 'audit_log', count(*) FROM core.audit_log
  ORDER BY 1;"
