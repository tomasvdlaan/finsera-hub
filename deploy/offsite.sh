#!/bin/bash
# Gets backups off the machine that holds the only copy, and makes failure loud.
#
# Runs on the HOST, not in a container: the postgres image ships no rsync, ssh or curl,
# and installing them into a backup job is how backup jobs start failing.
#
#   deploy/offsite.sh          # verify freshness → encrypt → push → report success
#
# Intended for cron, an hour or two after the nightly dump:
#   30 4 * * *  /opt/finsera/deploy/offsite.sh >> /var/log/finsera-offsite.log 2>&1
#
# Configuration comes from deploy/.env (BACKUP_REMOTE, BACKUP_HEARTBEAT_URL,
# BACKUP_ENCRYPT_PASSPHRASE_FILE). With none of them set this is a no-op that says so,
# so a half-configured server does not look like a working one.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
[[ -f "$HERE/.env" ]] && set -a && . "$HERE/.env" && set +a

DIR="$HERE/backups"
MAX_AGE_MINUTES="${BACKUP_MAX_AGE_MINUTES:-1560}" # 26h — a daily job with slack

fail() { echo "[offsite] FAILED: $*" >&2; exit 1; }

# ── freshness ───────────────────────────────────────────────
# Checked before pushing, not after: faithfully replicating a stale backup off-site
# produces two copies of nothing and a green log line.
[[ -d "$DIR" ]] || fail "no backup directory at $DIR — is the stack running?"
latest=$(find "$DIR" -name '*.sql.gz' -mmin "-${MAX_AGE_MINUTES}" -print0 2>/dev/null \
         | xargs -0 -r ls -1t 2>/dev/null | head -1 || true)
[[ -n "$latest" ]] || fail "no database dump newer than ${MAX_AGE_MINUTES} minutes in $DIR"

stamp=$(basename "$latest" | sed -E 's/.*-([0-9]{8}T[0-9]{6}Z)\.sql\.gz/\1/')
files="$DIR/files-${stamp}.tar.gz"
echo "[offsite] latest backup $stamp"

# Both halves or neither. A database dump whose file archive never arrived restores
# rows pointing at documents that do not exist.
to_push=("$latest")
[[ -f "$files" ]] && to_push+=("$files") || echo "[offsite] no file archive for $stamp (none expected if no documents yet)"

# ── encryption ──────────────────────────────────────────────
# Backups carry client records; off-site means on somebody else's disk. Optional only
# because a passphrase you lose is a backup you cannot read.
staging=""
if [[ -n "${BACKUP_ENCRYPT_PASSPHRASE_FILE:-}" ]]; then
  command -v gpg >/dev/null || fail "BACKUP_ENCRYPT_PASSPHRASE_FILE is set but gpg is not installed"
  [[ -r "$BACKUP_ENCRYPT_PASSPHRASE_FILE" ]] || fail "cannot read $BACKUP_ENCRYPT_PASSPHRASE_FILE"
  staging=$(mktemp -d)
  trap 'rm -rf "$staging"' EXIT
  encrypted=()
  for f in "${to_push[@]}"; do
    out="$staging/$(basename "$f").gpg"
    gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file "$BACKUP_ENCRYPT_PASSPHRASE_FILE" \
        --output "$out" "$f" || fail "gpg failed on $(basename "$f")"
    encrypted+=("$out")
  done
  to_push=("${encrypted[@]}")
  echo "[offsite] encrypted ${#to_push[@]} file(s)"
fi

# ── push ────────────────────────────────────────────────────
if [[ -z "${BACKUP_REMOTE:-}" ]]; then
  echo "[offsite] BACKUP_REMOTE is not set — nothing pushed. The only copies are on this server." >&2
  exit 1
fi

# Hetzner Storage Box speaks SSH on port 23, most other hosts on 22.
rsync -av --partial ${BACKUP_REMOTE_SSH_PORT:+-e "ssh -p $BACKUP_REMOTE_SSH_PORT"} \
      "${to_push[@]}" "$BACKUP_REMOTE/" || fail "rsync to $BACKUP_REMOTE"
echo "[offsite] pushed ${#to_push[@]} file(s) to $BACKUP_REMOTE"

# ── heartbeat ───────────────────────────────────────────────
# A dead man's switch: this pings only on success, so the alert is the ping that never
# arrives. Every failure path above exits non-zero and skips it deliberately.
if [[ -n "${BACKUP_HEARTBEAT_URL:-}" ]]; then
  curl -fsS -m 20 --retry 3 "$BACKUP_HEARTBEAT_URL" >/dev/null \
    && echo "[offsite] heartbeat sent" \
    || echo "[offsite] heartbeat ping failed (backup itself was fine)" >&2
fi
echo "[offsite] done"
