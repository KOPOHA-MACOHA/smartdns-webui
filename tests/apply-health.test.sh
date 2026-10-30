#!/bin/sh
# Exercise the production probe dispatcher with fake dig, no sockets or service.
set -eu
BASE_DIR=${BASE_DIR:-$(pwd)}
work=$(mktemp -d "${TMPDIR:-/tmp}/smartdns-health-test.XXXXXX")
trap 'rm -rf "$work"' EXIT
sed -n '/^apply_health()/,/^apply_quiesce()/p' "$BASE_DIR/apply-runtime.sh" | sed '$d' | sed "s|/opt/bin/timeout|timeout|g;s|/opt/bin/dig|$work/dig|g" > "$work/functions"
. "$work/functions"
apply_identity() { return 0; }
tx=$work;CONF_FILE="$work/config"
printf 'server 1.1.1.1\n' > "$CONF_FILE"
echo baseline > "$tx/before.sha"
echo fake > "$tx/live.pid"
: > "$tx/candidate.queries"
printf 'LISTEN\tUDP\t192.168.1.1\t6053\nLISTEN\tTCP\t192.168.1.1\t6054\nLISTEN\tUDP\t::1\t6055\nLISTEN\tTCP\t::1\t6056\n' > "$tx/candidate.plan"
cat > "$work/dig" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$(dirname "$0")/calls"
[ ! -f "$(dirname "$0")/unavailable" ] || exit 9
printf ';; status: NOERROR\nexample.org. 60 IN A 192.0.2.1\n'
EOF
chmod 700 "$work/dig"
apply_health "$CONF_FILE" >/dev/null
test "$(wc -l < "$work/calls")" -eq 4
grep -q '@192.168.1.1 -p 6053 example.org A +notcp' "$work/calls"
grep -q '@192.168.1.1 -p 6054 example.org A +tcp' "$work/calls"
grep -q '@::1 -p 6055 example.org A +notcp' "$work/calls"
grep -q '@::1 -p 6056 example.org A +tcp' "$work/calls"
echo 'PASS: production health dispatcher checks IPv4/IPv6 UDP/TCP without actual network'

# Rollback probes use the previous listener, not the candidate endpoint.
printf 'LISTEN\tUDP\t127.0.0.1\t5353\n' > "$tx/before.plan"
: > "$tx/before.queries"
: > "$work/calls"
apply_health "$tx/before.conf" >/dev/null
grep -q '@127.0.0.1 -p 5353' "$work/calls"
test "$(wc -l < "$work/calls")" -eq 1
# TCP-only profiles must use their listener for both route and static probes.
printf 'LISTEN\tTCP\t127.0.0.1\t6054\nADDRESS\tmanual.example\t192.0.2.1\n' > "$tx/candidate.plan"
printf 'ROUTE\tgroup\tlist\trouted.example\n' > "$tx/candidate.queries"
: > "$work/calls"
apply_health "$CONF_FILE" >/dev/null
test "$(wc -l < "$work/calls")" -eq 2
! grep -q 'routed.example'  "$work/calls"
grep -q '@127.0.0.1 -p 6054 manual.example A +tcp' "$work/calls"
# Missing and incorrect static replies must fail, as must a failed DNS request.
sed 's/192.0.2.1/192.0.2.2/' "$tx/candidate.plan" > "$tx/new-plan"
mv "$tx/new-plan" "$tx/candidate.plan"
if apply_health "$CONF_FILE" >/dev/null; then exit 1; fi
touch "$work/unavailable"
if apply_health "$CONF_FILE" >/dev/null; then exit 1; fi
rm "$work/unavailable"
: > "$tx/candidate.plan"
if apply_health "$CONF_FILE" >/dev/null; then exit 1; fi
echo 'PASS: rollback endpoints, TCP-only routes/static records, failed queries and empty plans'
