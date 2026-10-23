#!/bin/sh
# Real detached engine, disposable files, mocked bounded service adapter only.
set -eu
BASE_DIR=${BASE_DIR:-$(pwd)}
work=$(mktemp -d "${TMPDIR:-/tmp}/smartdns-apply-test.XXXXXX")
guard='';worker=''
cleanup() {
    [ -z "$worker" ] || wait "$worker" 2>/dev/null || true
    [ -z "$guard" ] || wait "$guard" 2>/dev/null || true
    rm -rf "$work"
}
trap cleanup EXIT
cp "$BASE_DIR/apply.sh" "$BASE_DIR/apply-plan.awk" "$BASE_DIR/validator.awk" "$BASE_DIR/validator-46.1.txt" "$work/"
cat > "$work/apply-runtime.sh" <<'EOF'
CONF_FILE="$BASE_DIR/live.conf"
APPLY_ROOT="$BASE_DIR/journals"
APPLY_LOCK="$BASE_DIR/operation.lock"
APPLY_TIMEOUT=timeout
apply_restart() {
    echo restart >> "$tx/calls"
    [ ! -f "$tx/rollback-failure" ] || ! grep -q BASELINE "$CONF_FILE" || return 1
    if grep -q CANDIDATE "$CONF_FILE"; then
        [ ! -f "$tx/restart-failure" ] || return 1
        if [ -f "$tx/kill-worker" ]; then touch "$tx/in-restart"; sleep 4; fi
    fi
    return 0
}
apply_health() {
    if grep -q CANDIDATE "$CONF_FILE"; then [ ! -f "$tx/dns-failure" ] || return 1; fi
    return 0
}
apply_identity() { [ ! -f "$tx/dead-process" ]; }
apply_quiesce() { sleep 1; }
EOF
cat > "$work/preflight.sh" <<'EOF'
#!/bin/sh
[ ! -f "$3/preflight-failure" ] || exit 1
: > "$3/$4.queries"
printf '%s\t%s\n' "$(sha256sum "$3/list" | awk '{print $1}')" "$3/list" > "$3/$4.inputs"
EOF
mkdir "$work/journals"
wait_state() {
    desired=$1;n=0
    while [ "$(cat "$tx/status")" != "$desired" ]; do
        sleep 1;n=$((n+1))
        if [ "$n" -gt 16 ]; then cat "$tx/status" "$tx/guard.log" "$tx/worker.log";return 1;fi
    done
}
start() {
    scenario=$1
    tx="$work/journals/tx-$scenario";mkdir "$tx" "$work/operation.lock" "$work/live.conf.webui-lock"
    printf 'server 1.1.1.1\n# BASELINE\n' > "$work/live.conf"
    chmod 640 "$work/live.conf"
    cp "$work/live.conf" "$tx/before.conf"
    printf 'server 1.0.0.1\n# CANDIDATE\n' > "$tx/candidate"
    cp -p "$work/live.conf" "$tx/mode-reference"; : > "$tx/mode-reference"
    sha256sum "$tx/before.conf" | awk '{print $1}' > "$tx/before.sha"
    sha256sum "$tx/candidate" | awk '{print $1}' > "$tx/candidate.sha"
    echo example.org > "$tx/list"
    echo ARMED > "$tx/status"
    echo "$(( $(date +%s) + 12 ))" > "$tx/deadline"
    case "$scenario" in restart-failure|dns-failure|preflight-failure|kill-worker) touch "$tx/$scenario" ;; esac
    nohup sh "$work/apply.sh" guard "$tx" </dev/null > "$tx/guard.log" 2>&1 & guard=$!
    n=0;while [ ! -f "$tx/armed" ];do sleep 1;n=$((n+1));[ "$n" -lt 4 ] || exit 1;done
    nohup sh "$work/apply.sh" worker "$tx" </dev/null > "$tx/worker.log" 2>&1 & worker=$!
    echo "$worker" > "$tx/worker.pid"
    awk '{print $22}' "/proc/$worker/stat" > "$tx/worker.stamp" 2>/dev/null || true
}
finish() {
    wait "$worker" 2>/dev/null || true;worker=''
    wait "$guard" 2>/dev/null || true;guard=''
    test ! -d "$work/operation.lock"
    test ! -d "$work/live.conf.webui-lock"
    test "$(ls -ld "$work/live.conf" | awk '{print $1}')" = '-rw-r-----'
}
for scenario in commit timeout restart-failure dns-failure preflight-failure kill-worker external-change list-change dead-process; do
    start "$scenario"
    case "$scenario" in
        commit) wait_state AWAITING_CONFIRMATION;touch "$tx/confirm";wait_state COMMITTED;grep -q CANDIDATE "$work/live.conf" ;;
        timeout) wait_state AWAITING_CONFIRMATION;echo 0 > "$tx/deadline"; # guard reads deadline once: request rollback now, equivalent tab cancellation
            touch "$tx/abort";wait_state ROLLED_BACK ;;
        preflight-failure) wait_state REJECTED;test ! -e "$tx/calls" ;;
        restart-failure|dns-failure) wait_state ROLLED_BACK ;;
        kill-worker)
            n=0;while [ ! -f "$tx/in-restart" ];do sleep 1;n=$((n+1));[ "$n" -lt 6 ] || exit 1;done
            kill -KILL "$worker";wait "$worker" 2>/dev/null || true
            wait_state ROLLED_BACK ;;
        external-change) wait_state AWAITING_CONFIRMATION;echo external > "$work/live.conf";touch "$tx/confirm";wait_state ROLLED_BACK ;;
        list-change) wait_state AWAITING_CONFIRMATION;echo changed > "$tx/list";touch "$tx/confirm";wait_state ROLLED_BACK ;;
        dead-process) wait_state AWAITING_CONFIRMATION;touch "$tx/dead-process" "$tx/confirm";wait_state ROLLED_BACK ;;
    esac
    if [ "$scenario" != commit ];then cmp "$work/live.conf" "$tx/before.conf";fi
    finish
    echo "PASS: apply $scenario"
done
# A failed rollback is never called success and must keep both locks.
start rollback-failure
wait_state AWAITING_CONFIRMATION
touch "$tx/rollback-failure" "$tx/abort"
wait_state ROLLBACK_FAILED
wait "$worker" 2>/dev/null || true;worker=''
wait "$guard" 2>/dev/null || true;guard=''
cmp "$work/live.conf" "$tx/before.conf"
test -d "$work/operation.lock";test -d "$work/live.conf.webui-lock"
rmdir "$work/operation.lock" "$work/live.conf.webui-lock"
echo 'PASS: failed rollback retains recovery journal and locks'
# A lost tab gives no confirmation: actual independent deadline must roll back.
start expiry
wait_state ROLLED_BACK
cmp "$work/live.conf" "$tx/before.conf"
finish
echo 'PASS: independent confirmation deadline'
