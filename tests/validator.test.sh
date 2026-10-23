#!/bin/sh
set -eu
BASE_DIR=${BASE_DIR:-$(pwd)}
API_SCRIPT=${API_SCRIPT:-$BASE_DIR/api.sh}
work=$(mktemp -d "${TMPDIR:-/tmp}/smartdns-validator-test.XXXXXX")
trap 'rm -rf "$work"' EXIT
sed -n '/^validate_config_file()/,$p' "$API_SCRIPT" > "$work/functions.sh"
. "$work/functions.sh"
TEST_MODE=1
VALIDATOR_TEST_VERSION=46.1
CONF_FILE="$work/working.conf"
CONFIG_BACKUP_DIR="$work/backups"
check() {
    want=$1
    rc=0
    validate_config_file "$work/candidate.conf" > "$work/report" || rc=$?
    if [ "$want" = pass ]; then
        if [ "$rc" != 0 ]; then cat "$work/report"; exit 1; fi
        ! grep -q '^E' "$work/report"
    else
        test "$rc" != 0
        grep -q '^E' "$work/report"
    fi
}
printf 'bind :53\nserver 1.1.1.1\n' > "$work/working.conf"
printf 'bind :53\nserver 1.1.1.1 -b\nserver-https https://dns.example/dns-query -g secure -group other\nnameserver /example.com/secure\ncache-size -1\n' > "$work/candidate.conf"
check pass
printf 'bind :53\nserver 1.1.1.1\nserver-h3 h3://dns.example/dns-query\n#server-quic quic://dns.example\n' > "$work/candidate.conf"
check pass
grep -q '^W' "$work/report"
grep -q '^I' "$work/report"
printf 'bind :53\nserver 1.1.1.1\nserver-quic quic://dns.example -group onlyquic\nnameserver /test.example/onlyquic\n' > "$work/candidate.conf"
check fail
printf 'bind :53\nserver-h3 h3://dns.example/dns-query\n' > "$work/candidate.conf"
check fail
for invalid in 'server 1.1.1.1 -group' 'server 1.1.1.1 -host-ip' 'server 1.1.1.1 -typo-option' 'server 1.1.1.1 https://dns.example/query' 'server-https http://dns.example/query' 'server 999.1.1.1' 'bind :99999' 'cache-size -2' 'response-mode fastest' 'speed-check-mode tcp:99999' 'prefetch-domain maybe' 'log-level verbose' 'cache-file' 'dualstack-ip-selection maybe' 'not-a-real-directive yes'; do
    printf 'bind :53\nserver 1.1.1.1\n%s\n' "$invalid" > "$work/candidate.conf"
    check fail
done
printf 'bind :53\nserver 1.1.1.1 -group secure\nserver-tls "tls://dns.example" -host-name "dns.example"\naddress /example.com/#\n# comment with unmatched quote "\n' > "$work/candidate.conf"
check pass
printf 'bind :53\nserver-https "https://dns.example/query\n' > "$work/candidate.conf"
check fail
printf 'bind :53\nserver 1.1.1.1 -e -g private\n' > "$work/candidate.conf"
check fail
printf 'bind :53 -group private\nserver 1.1.1.1 -e -g private\n' > "$work/candidate.conf"
check pass
printf 'bind :53\nserver 1.1.1.1 -g secure\ndomain-set -name test -file absent.list\nnameserver /domain-set:test/secure\n' > "$work/candidate.conf"
check fail
for valid in 'server 2001:db8::1' 'server-tls tls://dns.example -host-name -' 'server 1.1.1.1 -gprivate'; do
    printf 'bind :53\nserver 1.1.1.1\n%s\n' "$valid" > "$work/candidate.conf"
    check pass
done
printf 'example.com\n' > "$work/present.list"
printf 'bind :53\nserver 1.1.1.1 -gsecure\ndomain-set --name=test --file=present.list --type=list\nnameserver /domain-set:test/secure\n' > "$work/candidate.conf"
check pass
printf 'bind :53\nserver 1.1.1.1 -g secure\ndomain-set -name test -file present.list\nnameserver /domain-set:test/secure\n' > "$work/candidate.conf"
check pass
printf 'bind :53\nserver 1.1.1.1\nnameserver /domain-set:absent/default\n' > "$work/candidate.conf"
check fail
# Missing explicit bind uses the implicit default listener, not a fatal syntax error.
printf 'server 1.1.1.1\n' > "$work/candidate.conf"
check pass
grep -q '^W' "$work/report"
printf 'server 1.1.1.1 -e -g private\n' > "$work/candidate.conf"
check fail
# Unknown versions/includes must not be treated as proven compatibility.
printf 'conf-file /other/config.conf\nnameserver /example.com/included-group\n' > "$work/candidate.conf"
check pass
grep -q '^W' "$work/report"
VALIDATOR_TEST_VERSION=99.0
printf 'bind :53\nserver 1.1.1.1\nserver-h3 h3://dns.example/query\n' > "$work/candidate.conf"
check pass
grep -q '^W' "$work/report"
VALIDATOR_TEST_VERSION=46.1
# A direct save request must enforce validation without depending on browser JS.
HTTP_X_CONFIG_REVISION=$(config_hash "$CONF_FILE")
if printf 'bind :53\nserver-h3 h3://dns.example/query\n' | guarded_config_save > "$work/rejected"; then exit 1; fi
grep -q '^VALIDATION_FAILED' "$work/rejected"
test "$(config_hash "$CONF_FILE")" = "$HTTP_X_CONFIG_REVISION"
test ! -d "$CONFIG_BACKUP_DIR"
printf 'bind :53\nserver 1.1.1.1\nlog-level notice\n' | guarded_config_save > "$work/saved"
grep -q '^OK' "$work/saved"
test -f "$(sed -n 's/^BACKUP //p' "$work/saved")"
echo 'PASS: version profile, disabled and unsupported protocols, references, arguments, files, syntax, direct-save enforcement'
