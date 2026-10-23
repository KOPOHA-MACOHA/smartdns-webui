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
printf 'UDP6\texample.org\tA\nTCP6\texample.org\tA\nTCP\texample.org\tA\n' > "$tx/candidate.plan"
cat > "$work/dig" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$(dirname "$0")/calls"
printf ';; status: NOERROR\nexample.org. 60 IN A 192.0.2.1\n'
EOF
chmod 700 "$work/dig"
apply_health "$CONF_FILE" >/dev/null
test "$(wc -l < "$work/calls")" -eq 4
grep -q '@127.0.0.1 -p 53 example.org A +notcp' "$work/calls"
grep -q '@127.0.0.1 -p 53 example.org A +tcp' "$work/calls"
grep -q '@::1 -p 53 example.org A +notcp' "$work/calls"
grep -q '@::1 -p 53 example.org A +tcp' "$work/calls"
echo 'PASS: production health dispatcher checks IPv4/IPv6 UDP/TCP without actual network'
