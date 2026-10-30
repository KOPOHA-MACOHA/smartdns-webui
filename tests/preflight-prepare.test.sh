#!/bin/sh
set -eu
BASE_DIR=${BASE_DIR:-$(pwd)}
work=$(mktemp -d "${TMPDIR:-/tmp}/smartdns-preflight-prepare-test.XXXXXX")
trap 'rm -rf "$work"' EXIT
prepare() {
    rm -f "$work/sandbox.conf" "$work/files" "$work/probes"
    : > "$work/sandbox.conf"
    awk -v version=46.1 -v preflight=1 -v work="$work" -f "$BASE_DIR/validator.awk" -f "$BASE_DIR/preflight-prepare.awk" "$BASE_DIR/validator-46.1.txt" "$work/candidate" > "$work/report"
}
printf 'bind :53\ncache-size 65536\ncache-file /must/not/write/cache\nlog-file /must/not/write/log\nlog-syslog yes\naudit-file /must/not/write/audit\naudit-enable yes\nrestart-on-crash yes\nserver 1.1.1.1\nserver-tls tls://dns.example -g secure -e\ndomain-set -name route -file "relative list.list"\nnameserver /domain-set:route/secure\n' > "$work/candidate"
prepare
! grep -q '/must/not/write' "$work/sandbox.conf"
! grep -q -E '^bind(-tcp|-tls|-https)? :53' "$work/sandbox.conf"
grep -q '^cache-size 64$' "$work/sandbox.conf"
grep -q '^prefetch-domain no$' "$work/sandbox.conf"
grep -q '^cache-persist no$' "$work/sandbox.conf"
grep -q '^restart-on-crash no$' "$work/sandbox.conf"
grep -q '^log-syslog no$' "$work/sandbox.conf"
grep -q '^bind 127.0.0.1:16530' "$work/sandbox.conf"
grep -q 'secure' "$work/probes"
grep -q 'relative list.list' "$work/files"
grep -q "$work/list-1" "$work/sandbox.conf"
printf 'server 1.1.1.1\ndomain-set -name file -file "/source/valid.list"\nnameserver /domain-set:file/default\n' > "$work/candidate"
prepare
grep -q '/source/valid.list' "$work/files"
for unsafe in 'plugin /tmp/never-load-this' '"plugin" "/tmp/never-load-this"' 'conf-file /tmp/nested.conf' 'ipset /domain/test' 'nftset /domain/test' 'domain-rules /domain/ -ipset test' 'group-begin nested' 'user nobody' 'hosts-file /dev/zero' 'proxy-server socks5://127.0.0.1:9999 -name proxy'; do
    printf 'server 1.1.1.1\n%s\n' "$unsafe" > "$work/candidate"
    if prepare; then echo "Unsafe directive accepted: $unsafe";exit 1;fi
    grep -q '^E' "$work/report"
done
printf 'server-https https://dns.example/query\n' > "$work/candidate"
if prepare; then exit 1;fi
# Original quoted server values survive; no config text is ever evaluated by a shell.
printf 'server 1.1.1.1\nserver-https "https://dns.example/query" -http-host "$(touch /never-execute)"\n' > "$work/candidate"
prepare
grep -F -q '$(touch /never-execute)' "$work/sandbox.conf"
printf 'server 1.1.1.1\nnameserver /example.com/missing\n' > "$work/candidate"
# The separate static validator must catch this before preparation/launch.
if awk -v version=46.1 -f "$BASE_DIR/validator.awk" "$BASE_DIR/validator-46.1.txt" "$work/candidate" > "$work/static"; then exit 1;fi
grep -q '^E' "$work/static"
echo 'PASS: native preparation isolates ports/files/cache; refuses side effects and unsafe constructs; shares static lexer'
# Repeated domain-set names represent a union, not a duplicate declaration error.
printf 'bind :53\nserver 1.1.1.1\ndomain-set -name shared -file /source/one.list\ndomain-set -name shared -file /source/two.list\ndomain-set -name shared -file /source/three.list\nnameserver /domain-set:shared/default\n' > "$work/candidate"
prepare
test "$(wc -l < "$work/files")" -eq 3
test "$(grep -c '^domain-set -name "shared"' "$work/sandbox.conf")" -eq 3
test "$(grep -c '^ROUTE' "$work/probes")" -eq 3
for id in 1 2 3;do grep -q "LIST.*$id$" "$work/probes";done
echo 'PASS: shared domain-set copies and probes every member file'

# Resolver-only domain policies stay in the sandbox and add probes for their selected group.
printf 'bind :53\nserver 1.1.1.1\nserver-tcp 1.0.0.1 -exclude-default-group -group images\ndomain-set -name pictures -file /source/images.list\ndomain-rules /ytimg.com/ -nameserver images -response-mode fastest-ip -speed-check-mode tcp:443 -no-serve-expired\ndomain-rules /domain-set:pictures/ -nameserver images\nhttps-record /ytimg.com/#\n' > "$work/candidate"
prepare
grep -q '^domain-rules /ytimg.com/ -nameserver images' "$work/sandbox.conf"
grep -q '^https-record /ytimg.com/#$' "$work/sandbox.conf"
grep -q 'DOMAIN.*ytimg.com' "$work/probes"
grep -q 'LIST' "$work/probes"
for unsafe in 'domain-rules /domain/ -ipset test' 'domain-rules /domain/ -nftset test' 'domain-rules /domain/ -group other' 'domain-rules /domain/ -speed-check-mode tcp:99999' 'domain-rules /domain/ -response-mode wrong' 'domain-rules /domain/ -nameserver'; do
 printf 'server 1.1.1.1\n%s\n' "$unsafe" > "$work/candidate"
 if prepare; then echo "Unsafe domain policy accepted: $unsafe";exit 1;fi
done
printf 'server 1.1.1.1\ndomain-rules /ytimg.com/ -nameserver missing\n' > "$work/candidate"
if awk -v version=46.1 -f "$BASE_DIR/validator.awk" "$BASE_DIR/validator-46.1.txt" "$work/candidate" > "$work/static"; then exit 1;fi
grep -q '^E' "$work/static"
printf 'server 1.1.1.1\ndomain-rules /domain-set:missing/ -no-serve-expired\n' > "$work/candidate"
if awk -v version=46.1 -f "$BASE_DIR/validator.awk" "$BASE_DIR/validator-46.1.txt" "$work/candidate" > "$work/static"; then exit 1;fi
grep -q '^E' "$work/static"
echo 'PASS: safe domain policies preserve sandbox isolation and validate references'
