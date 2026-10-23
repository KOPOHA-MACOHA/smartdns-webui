#!/bin/sh
# Production API functions with fixed paths rewritten in a disposable copy.
set -eu
BASE_DIR=${BASE_DIR:-$(pwd)}
source_dir=$BASE_DIR
work=$(mktemp -d "${TMPDIR:-/tmp}/smartdns-apply-api.XXXXXX")
trap 'rm -rf "$work"' EXIT
cp "$source_dir/apply.sh" "$source_dir/apply-plan.awk" "$source_dir/validator.awk" "$source_dir/validator-46.1.txt" "$work/"
sed -n '/^config_hash()/,$p' "$source_dir/api.sh" | sed "s|/opt/var/backups/smartdns-webui/apply|$work/journals|g;s|/tmp/smartdns-webui-dns-operation.lock|$work/operation.lock|g;s|/opt/etc/smartdns/webui-safe-apply.enabled|$work/enabled|g" > "$work/api-functions"
. "$work/api-functions"
CONF_FILE="$work/live.conf";BASE_DIR=$work;TEST_MODE=0
validate_config_file() { return 0; }
valid_list_target() { [ "$1" = route.list ]; }
cat > "$work/apply-runtime.sh" <<'EOF'
CONF_FILE="$BASE_DIR/live.conf"
APPLY_ROOT="$BASE_DIR/journals"
APPLY_LOCK="$BASE_DIR/operation.lock"
APPLY_TIMEOUT=timeout
apply_restart() { touch "$tx/restarted"; }
apply_health() { return 0; }
apply_identity() { return 0; }
apply_quiesce() { return 0; }
EOF
cat > "$work/preflight.sh" <<'EOF'
: > "$3/$4.queries"
: > "$3/$4.inputs"
EOF
printf 'server 1.1.1.1\n' > "$CONF_FILE";chmod 640 "$CONF_FILE"
HTTP_X_CONFIG_REVISION=$(config_hash "$CONF_FILE")
if apply_request </dev/null > "$work/disabled";then exit 1;fi
grep -q 'not been enabled' "$work/disabled"
test ! -d "$work/operation.lock"
touch "$work/enabled"
TEST_MODE=1
if apply_request </dev/null > "$work/test-mode";then exit 1;fi
TEST_MODE=0
stale=$HTTP_X_CONFIG_REVISION
HTTP_X_CONFIG_REVISION=0000000000000000000000000000000000000000000000000000000000000000
if printf 'server 1.0.0.1\n' | apply_request > "$work/conflict";then exit 1;fi
grep -q '^CONFLICT:' "$work/conflict"
test ! -d "$work/operation.lock"
HTTP_X_CONFIG_REVISION=$stale
printf 'server 1.0.0.1\n' | apply_request > "$work/queued"
grep -q '^OK$' "$work/queued"
id=$(sed -n 's/^TRANSACTION //p' "$work/queued")
tx="$work/journals/$id"
n=0
while [ "$(cat "$tx/status")" != AWAITING_CONFIRMATION ];do sleep 1;n=$((n+1));[ "$n" -lt 8 ] || { cat "$tx/worker.log";exit 1; };done
test -e "$tx/restarted"
test "$(ls -ld "$tx/before.conf" | awk '{print $1}')" = '-rw-------'
test "$(ls -ld "$tx/candidate" | awk '{print $1}')" = '-rw-------'
if apply_request </dev/null > "$work/busy";then exit 1;fi
grep -q '^BUSY:' "$work/busy"
if guarded_list_request save route.list </dev/null > "$work/list-busy";then exit 1;fi
grep -q '^BUSY:' "$work/list-busy"
if apply_control ../escape status > "$work/invalid-id";then exit 1;fi
apply_control "$id" confirm > "$work/confirmed"
n=0
while [ "$(cat "$tx/status")" != COMMITTED ];do sleep 1;n=$((n+1));[ "$n" -lt 5 ] || exit 1;done
test ! -d "$work/operation.lock";test ! -d "$CONF_FILE.webui-lock"
test "$(ls -ld "$CONF_FILE" | awk '{print $1}')" = '-rw-r-----'
printf 'ROLLOUT_INTERRUPTED\n' > "$tx/status"
HTTP_X_CONFIG_REVISION=$(config_hash "$CONF_FILE")
if apply_request </dev/null > "$work/unresolved";then exit 1;fi
grep -q 'unresolved apply journal' "$work/unresolved"
echo 'PASS: apply API feature gate, test-mode refusal, stale revision, arming/detachment, confirmation, private backups, shared writer locks, unresolved journal'
