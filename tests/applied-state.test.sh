#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
sed -n '/^config_hash()/,$p' "$base/api.sh" | sed "s|/opt/var/backups/smartdns-webui/apply|$work/journals|g;s|/tmp/smartdns-webui-dns-operation.lock|$work/operation.lock|g" > "$work/api"
. "$work/api"
BASE_DIR=$base; TEST_MODE=0; CONF_FILE=$work/live
mkdir -p "$work/journals/tx-example"
journal=$work/journals/tx-example
cat > "$journal/candidate" <<'CONF'
bind :53
server 1.1.1.1
log-level info
domain-rules /one.test/ -nameserver ru -no-serve-expired
https-record /two.test/#
https-record /one.test/#
domain-rules /two.test/ -nameserver ru -no-serve-expired
CONF
cp "$journal/candidate" "$CONF_FILE"
config_hash "$journal/candidate" > "$journal/candidate.sha"
printf 'COMMITTED\n' > "$journal/status"
: > "$journal/candidate.inputs"
applied_config_identity() { [ ! -e "$work/dead-process" ]; }
expect_applied() { [ "$(get_applied_config_status)" = "APPLIED $(config_hash "$CONF_FILE")" ] || { echo 'Expected confirmed saved settings'; exit 1; }; }
expect_unknown() { [ "$(get_applied_config_status)" = UNCONFIRMED ] || { echo 'Incorrectly confirmed unknown settings'; exit 1; }; }
expect_applied
cat > "$CONF_FILE" <<'CONF'
# formatting only
  bind   :53

domain-rules /one.test/ -nameserver ru -no-serve-expired
https-record /one.test/#
domain-rules /two.test/ -nameserver ru -no-serve-expired
https-record /two.test/#
log-level info
server 1.1.1.1
CONF
expect_applied
sed 's/-nameserver ru/-nameserver other/g' "$CONF_FILE" > "$work/different"
old=$(semantic_config_hash "$CONF_FILE")
[ "$old" != "$(semantic_config_hash "$work/different")" ]
cp "$CONF_FILE" "$work/cosmetic"; cp "$work/different" "$CONF_FILE"; expect_unknown
cp "$work/cosmetic" "$CONF_FILE"
printf 'one.test\n' > "$work/domains"
printf '%s\t%s\n' "$(config_hash "$work/domains")" "$work/domains" > "$journal/candidate.inputs"
expect_applied
printf 'two.test\n' >> "$work/domains"; expect_unknown
: > "$journal/candidate.inputs"
touch "$work/dead-process"; expect_unknown; rm "$work/dead-process"
mkdir "$work/operation.lock"; expect_unknown; rmdir "$work/operation.lock"
printf 'ROLLBACK_FAILED\n' > "$journal/status"; expect_unknown
printf 'COMMITTED\n' > "$journal/status"
cp "$journal/candidate.sha" "$work/hash"; printf 'bad\n' > "$journal/candidate.sha"; expect_unknown
cp "$work/hash" "$journal/candidate.sha"
TEST_MODE=1; expect_unknown; TEST_MODE=0
cp "$journal/candidate" "$journal/before.conf"; cp "$journal/candidate.sha" "$journal/before.sha"; cp "$journal/candidate.inputs" "$journal/before.inputs"
printf 'ROLLED_BACK\n' > "$journal/status"; expect_applied
printf 'server 1.1.1.1 -http-host "a  b"\n' > "$work/a"
printf 'server 1.1.1.1 -http-host "a b"\n' > "$work/b"
[ "$(semantic_config_hash "$work/a")" != "$(semantic_config_hash "$work/b")" ]
printf 'domain-rules /one.test/ -nameserver a\ndomain-rules /one.test/ -nameserver b\n' > "$work/a"
printf 'domain-rules /one.test/ -nameserver b\ndomain-rules /one.test/ -nameserver a\n' > "$work/b"
[ "$(semantic_config_hash "$work/a")" != "$(semantic_config_hash "$work/b")" ]
printf 'conf-file /some/config\nhttps-record /one.test/#\nhttps-record /two.test/#\n' > "$work/a"
printf 'conf-file /some/config\nhttps-record /two.test/#\nhttps-record /one.test/#\n' > "$work/b"
[ "$(semantic_config_hash "$work/a")" != "$(semantic_config_hash "$work/b")" ]
printf 'server 1.1.1.1\nserver 9.9.9.9\n' > "$work/a"
printf 'server 9.9.9.9\nserver 1.1.1.1\n' > "$work/b"
[ "$(semantic_config_hash "$work/a")" != "$(semantic_config_hash "$work/b")" ]
printf 'server "unfinished\n' > "$work/a"
if semantic_config_hash "$work/a" >/dev/null; then echo 'Accepted malformed quoting'; exit 1; fi
printf 'Applied-state and cosmetic equivalence tests passed\n'
if command -v busybox >/dev/null 2>&1 && [ "${MEANING_BUSYBOX:-0}" = 0 ]; then
    mkdir "$work/busybox-bin"
    ln -s "$(command -v busybox)" "$work/busybox-bin/awk"
    MEANING_BUSYBOX=1 PATH="$work/busybox-bin:$PATH" sh "$0"
fi
