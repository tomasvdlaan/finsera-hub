#!/bin/bash
# Nightly pg_dump with retention pruning (spec §9).
#
# Deliberately a loop rather than cron: one less moving part in the container, and the
# interval is configurable for testing (BACKUP_INTERVAL_SECONDS).
set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-30}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
DIR=/backups
STORAGE_DIR="${STORAGE_DIR:-/storage}"

mkdir -p "$DIR"

take_backup() {
  local stamp db_file files_file
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  db_file="$DIR/${PGDATABASE}-${stamp}.sql.gz"
  files_file="$DIR/files-${stamp}.tar.gz"

  echo "[backup] starting $db_file"
  # Write to .partial first so an interrupted dump is never mistaken for a good one.
  if pg_dump --clean --if-exists | gzip > "${db_file}.partial"; then
    mv "${db_file}.partial" "$db_file"
    echo "[backup] wrote $db_file ($(du -h "$db_file" | cut -f1))"
  else
    rm -f "${db_file}.partial"
    echo "[backup] FAILED (database)" >&2
    return 1
  fi

  # Uploaded files live outside Postgres, so a database dump alone would restore rows
  # pointing at documents that no longer exist.
  if [[ -d "$STORAGE_DIR" ]]; then
    if tar -czf "${files_file}.partial" -C "$STORAGE_DIR" . 2>/dev/null; then
      mv "${files_file}.partial" "$files_file"
      echo "[backup] wrote $files_file ($(du -h "$files_file" | cut -f1))"
    else
      rm -f "${files_file}.partial"
      echo "[backup] FAILED (files)" >&2
      return 1
    fi
  else
    echo "[backup] no storage directory at $STORAGE_DIR — skipping files" >&2
  fi

  # Both halves share a timestamp, so pruning them together keeps pairs intact.
  find "$DIR" -name "${PGDATABASE}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
  find "$DIR" -name "files-*.tar.gz" -mtime "+${RETENTION_DAYS}" -delete
  echo "[backup] retention pruned to ${RETENTION_DAYS} days"
}

# Take one immediately so a fresh deploy has a backup before the first night.
take_backup || true

while true; do
  sleep "$INTERVAL"
  take_backup || echo "[backup] cycle failed, will retry next interval" >&2
done
