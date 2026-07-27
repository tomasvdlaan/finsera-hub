#!/bin/bash
# Nightly pg_dump with retention pruning (spec §9).
#
# Deliberately a loop rather than cron: one less moving part in the container, and the
# interval is configurable for testing (BACKUP_INTERVAL_SECONDS).
set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-30}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
DIR=/backups

mkdir -p "$DIR"

take_backup() {
  local stamp file
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file="$DIR/${PGDATABASE}-${stamp}.sql.gz"

  echo "[backup] starting $file"
  # Write to .partial first so an interrupted dump is never mistaken for a good one.
  if pg_dump --clean --if-exists | gzip > "${file}.partial"; then
    mv "${file}.partial" "$file"
    echo "[backup] wrote $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "${file}.partial"
    echo "[backup] FAILED" >&2
    return 1
  fi

  find "$DIR" -name "${PGDATABASE}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
  echo "[backup] retention pruned to ${RETENTION_DAYS} days"
}

# Take one immediately so a fresh deploy has a backup before the first night.
take_backup || true

while true; do
  sleep "$INTERVAL"
  take_backup || echo "[backup] cycle failed, will retry next interval" >&2
done
