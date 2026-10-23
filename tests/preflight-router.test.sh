#!/bin/sh
# Native integration tests for Keenetic. Never use the active service/config.
set -eu
BASE_DIR=${BASE_DIR:-$(pwd)}
[ -x /opt/sbin/smartdns ] || { echo 'SKIP: native Keenetic runtime unavailable';exit 0; }
work=$(mktemp -d /opt/tmp/webui-preflight-native-test.XXXXXX)
fixture='';fixture_stamp='';fixture_launcher='';fixture_launcher_stamp='';job='';owns_lock=0
lock=/tmp/smartdns-webui-dns-operation.lock
cleanup() {
    [ -z "$job" ] || { kill -TERM "$job" 2>/dev/null || true;wait "$job" 2>/dev/null || true; }
    if [ -n "$fixture" ] && [ -n "$fixture_stamp" ] && [ "$(awk '{print $22}' "/proc/$fixture/stat" 2>/dev/null)" = "$fixture_stamp" ]; then kill -TERM "$fixture" 2>/dev/null || true; fi
    if [ -n "$fixture_launcher" ]; then
        [ "$(awk '{print $22}' "/proc/$fixture_launcher/stat" 2>/dev/null)" != "$fixture_launcher_stamp" ] || kill -TERM "$fixture_launcher" 2>/dev/null || true
        wait "$fixture_launcher" 2>/dev/null || true
    fi
    [ "$owns_lock" = 0 ] || rmdir "$lock" 2>/dev/null || true
    rm -rf "$work"
}
trap cleanup EXIT
if netstat -ln | awk '$4 ~ /:16520$/ {busy=1} END{exit !busy}';then echo 'Fixture port busy';exit 1;fi
test ! -d "$lock"
printf 'bind 127.0.0.1:16520\ncache-size 16\ncache-persist no\nprefetch-domain no\nserve-expired no\naudit-enable no\nlog-syslog no\ncache-file %s/upstream.cache\nlog-file %s/upstream.log\nserver 127.0.0.1:16529\naddress /example.org/192.0.2.10\naddress /routed.example/192.0.2.20\n' "$work" "$work" > "$work/upstream.conf"
/opt/bin/timeout -k 2 90 /opt/sbin/smartdns -f -c "$work/upstream.conf" -p "$work/upstream.pid" > "$work/upstream.out" 2>&1 &
fixture_launcher=$!
fixture_launcher_stamp=$(awk '{print $22}' "/proc/$fixture_launcher/stat")
sleep 1
fixture=$(cat "$work/upstream.pid")
fixture_stamp=$(awk '{print $22}' "/proc/$fixture/stat")
/opt/bin/dig @127.0.0.1 -p 16520 example.org A +time=1 +tries=1 +short | grep -q 192.0.2.10
printf 'routed.example\n' > "$work/route.list"
printf 'bind :53\nserver 127.0.0.1:16520\nserver 127.0.0.1:16520 -g special -e\ndomain-set -name routed -file %s/route.list\nnameserver /domain-set:routed/special\n' "$work" > "$work/candidate"
if ! /opt/bin/timeout -k 3 45 /bin/sh "$BASE_DIR/preflight.sh" "$work/candidate" "$work" > "$work/pass"; then cat "$work/pass";exit 1;fi
! grep -q '^E' "$work/pass"
grep -q 'Группа special' "$work/pass"
grep -q 'Маршрут routed.example' "$work/pass"
test ! -d "$lock"
if netstat -ln | awk '$4 ~ /:1653[0-8]$/ {used=1}END{exit !used}';then echo 'Test ports leaked';exit 1;fi
# A failing upstream is reported as a failed check; no fallback to working :53.
printf 'bind :53\nserver 127.0.0.1:16529\n' > "$work/candidate"
if /opt/bin/timeout -k 3 45 /bin/sh "$BASE_DIR/preflight.sh" "$work/candidate" "$work" > "$work/fail";then exit 1;fi
grep -q '^E' "$work/fail"
test ! -d "$lock"
# Cancellation interrupts the candidate, cleans up its listeners, and releases lock.
/opt/bin/timeout -k 3 45 /bin/sh "$BASE_DIR/preflight.sh" "$work/candidate" "$work" > "$work/cancel" &
job=$!
tries=0
while [ ! -d "$lock" ];do sleep 1;tries=$((tries+1));[ "$tries" -lt 6 ] || exit 1;done
kill -TERM "$job" 2>/dev/null || true
wait "$job" 2>/dev/null || true
job=''
test ! -d "$lock"
if netstat -ln | awk '$4 ~ /:1653[0-8]$/ {used=1}END{exit !used}';then exit 1;fi
# Service restart must refuse the common lock, never call the real init script.
sed -n '/^validate_config_file()/,$p' "$BASE_DIR/api.sh" > "$work/functions"
. "$work/functions"
restart_smartdns() { touch "$work/restart-called"; }
mkdir "$lock";owns_lock=1
if guarded_restart > "$work/busy";then exit 1;fi
test ! -e "$work/restart-called"
if /bin/sh "$BASE_DIR/preflight.sh" "$work/candidate" "$work" > "$work/locked";then exit 1;fi
grep -q '^E' "$work/locked"
rmdir "$lock";owns_lock=0
echo 'PASS: native startup, UDP/TCP, named group and route, failing upstream, cancellation cleanup, shared restart lock'
