#!/bin/sh
# Transaction engine. The adapter supplies bounded service/DNS operations.
# Never source a path or execute a command received from HTTP.
set -u
umask 077
BASE_DIR=$(dirname "$(readlink -f "$0")")
mode=${1:?mode}; tx=${2:?transaction directory}
. "$BASE_DIR/apply-runtime.sh"
hash() { sha256sum "$1" | awk '{print $1}'; }
state() { printf '%s\n' "$1" > "$tx/status.tmp.$$" && mv -f "$tx/status.tmp.$$" "$tx/status"; }
same() { [ -n "$2" ] && [ "$(awk '{print $22}' "/proc/$1/stat" 2>/dev/null)" = "$2" ]; }
release() {
    leftover=$(cat "$tx/install.path" 2>/dev/null || true)
    case "$leftover" in "$CONF_FILE".apply.*) rm -f "$leftover" ;; esac
    rm -f "$APPLY_LOCK/owner" "$APPLY_LOCK/transaction"
    rmdir "$APPLY_LOCK" 2>/dev/null || true
    rmdir "$CONF_FILE.webui-lock" 2>/dev/null || true
}
log() { printf '[%s] %s\n' "$(date +%s)" "$*" >> "$tx/events"; }
inputs_unchanged() (
    tab=$(printf '\t')
    [ -f "$tx/$1.inputs" ] || exit 1
    while IFS="$tab" read -r checksum path; do
        [ "$(hash "$path")" = "$checksum" ] || exit 1
    done < "$tx/$1.inputs"
)
case "$tx" in "$APPLY_ROOT"/tx-*) ;; *) exit 2 ;; esac
[ -d "$tx" ] && [ ! -L "$tx" ] || exit 2
expected=$(cat "$tx/before.sha")
candidate_sha=$(cat "$tx/candidate.sha")
case "$mode" in
    worker)
        # Guard must be independently alive before any possible live write.
        trap 'touch "$tx/abort"; exit 1' TERM INT
        guard=$(cat "$tx/guard.pid"); guard_stamp=$(cat "$tx/guard.stamp")
        same "$guard" "$guard_stamp" || exit 1
        fail() { log "$*"; touch "$tx/abort"; exit 1; }
        [ "$(hash "$tx/before.conf")" = "$expected" ] || fail 'Backup checksum mismatch'
        state CHECKING || fail status
        for snapshot in before candidate; do
            file="$tx/$snapshot"; [ "$snapshot" != before ] || file="$tx/before.conf"
            "$APPLY_TIMEOUT" -k 2 45 /bin/sh "$BASE_DIR/preflight.sh" "$file" "$(dirname "$CONF_FILE")" "$tx" "$snapshot" > "$tx/$snapshot.preflight" 2>&1 || fail "$snapshot preflight failed"
            : > "$tx/$snapshot.plan"
            awk -v version=46.1 -v preflight=1 -v output="$tx/$snapshot.plan" -f "$BASE_DIR/validator.awk" -f "$BASE_DIR/apply-plan.awk" "$BASE_DIR/validator-46.1.txt" "$file" > "$tx/$snapshot.plan-report" || fail "$snapshot live probe plan unsupported"
            [ ! -e "$tx/abort" ] || exit 1
        done
        [ ! -e "$tx/abort" ] || exit 1
        [ "$(hash "$tx/candidate")" = "$candidate_sha" ] || fail 'Candidate changed'
        inputs_unchanged before && inputs_unchanged candidate || fail 'Domain lists changed'
        [ "$(hash "$CONF_FILE")" = "$expected" ] || fail 'Saved configuration changed'
        # Baseline health is a prerequisite, not proof that disk == process state.
        apply_health "$tx/before.conf" > "$tx/baseline-health" 2>&1 || fail 'Baseline DNS failed'
        [ ! -e "$tx/abort" ] || exit 1
        # Mark BEFORE mv: the guard also covers death between mv and status update.
        touch "$tx/may-change" || fail marker
        state APPLYING || fail status
        install=$(mktemp "${CONF_FILE}.apply.XXXXXX") || fail tempfile
        printf '%s\n' "$install" > "$tx/install.path" || fail tempfile
        cp -p "$tx/mode-reference" "$install" && cat "$tx/candidate" > "$install" || fail copy
        [ ! -e "$tx/abort" ] || exit 1
        [ "$(hash "$CONF_FILE")" = "$expected" ] || fail 'Concurrent external change'
        mv -f "$install" "$CONF_FILE" || fail replace
        [ ! -e "$tx/abort" ] || exit 1
        apply_restart > "$tx/restart" 2>&1 || fail 'Restart failed'
        [ ! -e "$tx/abort" ] || exit 1
        state VERIFYING || fail status
        apply_health "$CONF_FILE" > "$tx/health" 2>&1 || fail 'Candidate DNS failed'
        inputs_unchanged candidate || fail 'Domain lists changed after restart'
        [ "$(hash "$CONF_FILE")" = "$candidate_sha" ] || fail 'Configuration changed after restart'
        [ ! -e "$tx/abort" ] || exit 1
        touch "$tx/healthy" || fail healthy
        state AWAITING_CONFIRMATION || fail status
        log 'DNS checks passed; explicit confirmation required'
        ;;
    guard)
        # nohup must preserve ignored HUP. Guard alone owns commit/rollback/locks.
        trap '' HUP INT TERM
        printf '%s\n' "$$" > "$tx/guard.pid"
        awk '{print $22}' "/proc/$$/stat" > "$tx/guard.stamp"
        touch "$tx/armed" || exit 1
        deadline=$(cat "$tx/deadline")
        while :; do
            [ ! -e "$tx/abort" ] || break
            [ "$(date +%s)" -lt "$deadline" ] || break
            if [ -f "$tx/confirm" ] && [ -f "$tx/healthy" ] && [ "$(cat "$tx/status")" = AWAITING_CONFIRMATION ]; then
                # Never commit a different disk snapshot or a dead service.
                if [ "$(hash "$CONF_FILE")" = "$candidate_sha" ] && inputs_unchanged candidate && apply_identity; then
                    if state COMMITTED; then log 'Committed'; release; exit 0; fi
                fi
                break
            fi
            if [ -f "$tx/worker.pid" ] && [ -f "$tx/worker.stamp" ]; then
                worker=$(cat "$tx/worker.pid"); stamp=$(cat "$tx/worker.stamp")
                if ! same "$worker" "$stamp" && [ ! -f "$tx/healthy" ]; then break; fi
            fi
            sleep 1
        done
        touch "$tx/abort"
        worker=$(cat "$tx/worker.pid" 2>/dev/null || true)
        stamp=$(cat "$tx/worker.stamp" 2>/dev/null || true)
        if [ -n "$worker" ] && same "$worker" "$stamp"; then
            kill -TERM "$worker" 2>/dev/null || true
            sleep 1
            same "$worker" "$stamp" && kill -KILL "$worker" 2>/dev/null || true
        fi
        if [ ! -f "$tx/may-change" ]; then
            state REJECTED || exit 1
            log 'Rejected before changing live file'; release; exit 0
        fi
        state ROLLING_BACK
        # A killed shell can leave its bounded init child alive. Let its 15+2 s
        # timeout finish before running another init command.
        apply_quiesce
        if [ "$(hash "$tx/before.conf")" != "$expected" ]; then
            state ROLLBACK_FAILED; log 'Backup checksum mismatch; manual recovery required'; exit 1
        fi
        restore=$(mktemp "${CONF_FILE}.restore.XXXXXX") || { state ROLLBACK_FAILED; log 'Restore temporary file failed'; exit 1; }
        cp -p "$tx/mode-reference" "$restore" && cat "$tx/before.conf" > "$restore" && mv -f "$restore" "$CONF_FILE" || {
            rm -f "$restore"
            state ROLLBACK_FAILED; log 'Restore write failed; manual recovery required'; exit 1;
        }
        if apply_restart > "$tx/rollback-restart" 2>&1 && apply_health "$CONF_FILE" > "$tx/rollback-health" 2>&1; then
            state ROLLED_BACK || exit 1
            log 'Previous file restored and DNS checks passed'; release
        else
            state ROLLBACK_FAILED; log 'Previous file restored; service/DNS recovery not confirmed; locks retained'; exit 1
        fi
        ;;
    *) exit 2 ;;
esac
