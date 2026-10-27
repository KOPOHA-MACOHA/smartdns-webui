#!/bin/sh
set -eu
BASE_DIR=${BASE_DIR:-$(pwd)}
work=$(mktemp -d "${TMPDIR:-/tmp}/smartdns-apply-plan.XXXXXX")
trap 'rm -rf "$work"' EXIT
plan() {
    : > "$work/plan"
    awk -v version=46.1 -v preflight=1 -v output="$work/plan" -f "$BASE_DIR/validator.awk" -f "$BASE_DIR/apply-plan.awk" "$BASE_DIR/validator-46.1.txt" "$work/config" > "$work/report"
}
printf 'bind :53\nbind-tcp 127.0.0.1:53\nserver 1.1.1.1\naddress /one.example/two.example/192.0.2.1,192.0.2.2\n' > "$work/config"
plan
grep -q '^LISTEN' "$work/plan"
grep -q "$(printf 'ADDRESS\tone.example\t192.0.2.1,192.0.2.2')" "$work/plan"
grep -q "$(printf 'ADDRESS\ttwo.example\t192.0.2.1,192.0.2.2')" "$work/plan"
printf 'bind [::]:53\nbind-tcp [::]:53\nserver 1.1.1.1\n' > "$work/config"
plan
grep -q 'LISTEN.*UDP.*::1' "$work/plan"
grep -q 'LISTEN.*TCP.*::1' "$work/plan"
grep -q 'LISTEN.*TCP' "$work/plan"
printf 'bind 192.168.1.1:6053\nbind-tcp [2001:db8::1]:6054\n' > "$work/config"
plan
grep -q 'LISTEN.*UDP.*192.168.1.1.*6053' "$work/plan"
grep -q 'LISTEN.*TCP.*2001:db8::1.*6054' "$work/plan"
for line in 'bind :0' 'bind :65536' 'bind 999.1.1.1:53' 'bind example.org:53' 'bind [:::]:53' 'bind [1::2::3]:53' 'bind [12345::1]:53' 'bind [1:2:3]:53' 'bind [::]:53 -group special' 'bind :53 -group special' 'bind-tls :853' 'address /a.example/2001:db8::1' 'address /*.example/192.0.2.1'; do
    printf '%s\n' "$line" > "$work/config"
    if plan;then echo "Unsupported plan accepted: $line";exit 1;fi
    grep -q '^E' "$work/report"
done
echo 'PASS: live probe plan preserves IPv4 addresses, multiple names, explicit TCP; refuses unsupported bind/address forms'
