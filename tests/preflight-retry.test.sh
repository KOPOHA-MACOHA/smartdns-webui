#!/bin/sh
set -eu
BASE_DIR=${BASE_DIR:-$(pwd)}
work=$(mktemp -d "${TMPDIR:-/tmp}/preflight-retry-test.XXXXXX")
trap 'rm -rf "$work"' EXIT
sed -n '/^check_queries() {/,/^}/p' "$BASE_DIR/preflight.sh" > "$work/function"
. "$work/function"
tab=$(printf '\t')
report() { printf '%s\t%s\n' "$1" "$2" >> "$work/report"; }
probe() {
 printf '%s:%s\n' "$1" "$4" >> "$work/calls"
 case "$1" in cold.example) [ -f "$work/ready" ] ;; warm.example) touch "$work/ready" ;; bad.example) return 1 ;; esac
}
printf 'GROUP\tdefault\t16531\tcold.example\nROUTE\tteam\t16530\twarm.example\n' > "$work/queries"
check_queries
test "$failed" -eq 0
test "$(grep -c '^cold.example:A$' "$work/calls")" -eq 2
! grep -q '^E' "$work/report"
printf 'GROUP\tdefault\t16531\tbad.example\n' > "$work/queries"
check_queries
test "$failed" -eq 1
grep -q '^E' "$work/report"
test "$(grep -c '^bad.example:A$' "$work/calls")" -eq 2
echo 'PASS: deferred retry handles cold start, retains A expectation and fails closed on persistent errors'
