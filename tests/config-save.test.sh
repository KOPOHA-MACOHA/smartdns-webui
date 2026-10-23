#!/bin/sh
# Exercise the production functions only against a private disposable directory.
set -eu
API_SCRIPT=${API_SCRIPT:-./api.sh}
work=$(mktemp -d "${TMPDIR:-/tmp}/smartdns-save-test.XXXXXX")
writer=''
cleanup() { [ -z "$writer" ] || wait "$writer" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT
sed -n '/^config_hash()/,$p' "$API_SCRIPT" > "$work/functions.sh"
. "$work/functions.sh"
# This suite isolates locking/backups; validation is exercised in validator.test.sh.
validate_config_file() { return 0; }
TEST_MODE=1
CONF_FILE="$work/config.conf"
CONFIG_BACKUP_DIR="$work/backups"
printf 'original\n' > "$CONF_FILE"
chmod 640 "$CONF_FILE"
config_snapshot > "$work/snapshot"
HTTP_X_CONFIG_REVISION=$(config_hash "$CONF_FILE")
test "$(head -n 1 "$work/snapshot")" = "REVISION $HTTP_X_CONFIG_REVISION"
tail -n +2 "$work/snapshot" > "$work/read.conf"
cmp "$CONF_FILE" "$work/read.conf"
printf 'new\n' | guarded_config_save > "$work/saved"
grep -q '^OK$' "$work/saved"
test "$(cat "$CONF_FILE")" = new
test "$(ls -ld "$CONF_FILE" | awk '{print $1}')" = '-rw-r-----'
backup=$(sed -n 's/^BACKUP //p' "$work/saved")
test "$(cat "$backup")" = original
test "$(ls -ld "$backup" | awk '{print $1}')" = '-rw-------'
# A stale browser and an older client without the revision cannot overwrite it.
if printf 'stale\n' | guarded_config_save > "$work/conflict"; then exit 1; fi
grep -q '^CONFLICT:' "$work/conflict"
test "$(cat "$CONF_FILE")" = new
HTTP_X_CONFIG_REVISION=''
if printf 'unsafe\n' | guarded_config_save > "$work/missing"; then exit 1; fi
test "$(cat "$CONF_FILE")" = new
# Failed backup creation is fail-closed; the lock is released for the next attempt.
HTTP_X_CONFIG_REVISION=$(config_hash "$CONF_FILE")
CONFIG_BACKUP_DIR="$work/not-a-directory"
touch "$CONFIG_BACKUP_DIR"
if printf 'unsafe\n' | guarded_config_save > "$work/backup-error" 2>/dev/null; then exit 1; fi
test "$(cat "$CONF_FILE")" = new
test ! -d "${CONF_FILE}.webui-lock"
CONFIG_BACKUP_DIR="$work/backups"
# Hold the first save open; the other writer must be refused while the lock exists.
(printf 'winner\n'; sleep 2) | guarded_config_save > "$work/winner" &
writer=$!
tries=0
while [ ! -d "${CONF_FILE}.webui-lock" ]; do
    tries=$((tries + 1)); [ "$tries" -lt 30 ] || exit 1
    sleep 1
done
if printf 'loser\n' | guarded_config_save > "$work/busy"; then exit 1; fi
grep -q '^BUSY:' "$work/busy"
wait "$writer"
writer=''
grep -q '^OK$' "$work/winner"
test "$(cat "$CONF_FILE")" = winner
# Retention bounds disk use, and the most recent backup remains available.
i=0
while [ "$i" -lt 23 ]; do
    HTTP_X_CONFIG_REVISION=$(config_hash "$CONF_FILE")
    printf 'version-%s\n' "$i" | guarded_config_save > "$work/saved"
    grep -q '^OK$' "$work/saved"
    i=$((i + 1))
done
test "$(find "$CONFIG_BACKUP_DIR" -type f | wc -l | tr -d ' ')" = 20
backup=$(sed -n 's/^BACKUP //p' "$work/saved")
test "$(cat "$backup")" = version-21
HTTP_X_CONFIG_REVISION=$(config_hash "$CONF_FILE")
cat "$CONF_FILE" | guarded_config_save > "$work/noop"
grep -q '^OK$' "$work/noop"
! grep -q '^BACKUP ' "$work/noop"
echo 'PASS: snapshot, backup contents and permissions, stale/missing revision, backup failure, lock contention, retention, no-op'
