#!/bin/sh
# Fixed production adapter; tests copy the engine beside their mock adapter.
# No HTTP-controlled paths, shell snippets, or environment-based test hooks.
CONF_FILE=/opt/etc/smartdns/smartdns.conf
APPLY_ROOT=/opt/var/backups/smartdns-webui/apply
APPLY_LOCK=/tmp/smartdns-webui-dns-operation.lock
APPLY_TIMEOUT=/opt/bin/timeout
apply_pids() {
    for p in $(pidof smartdns 2>/dev/null); do
        [ "$(readlink "/proc/$p/exe" 2>/dev/null)" != /opt/sbin/smartdns ] || printf '%s\n' "$p"
    done
}
apply_identity() {
    set -- $(apply_pids)
    [ "$#" = 1 ] || return 1
    [ -f "$tx/live.pid" ] && [ -f "$tx/live.stamp" ] || return 1
    [ "$1" = "$(cat "$tx/live.pid")" ] && [ "$(awk '{print $22}' "/proc/$1/stat" 2>/dev/null)" = "$(cat "$tx/live.stamp")" ]
}
apply_restart() {
    old=$(apply_pids)
    # This adapter intentionally supports only the audited Entware init script.
    [ -x /opt/etc/init.d/S38smartdns ] || return 1
    /opt/bin/timeout -k 2 15 /opt/etc/init.d/S38smartdns restart || return 1
    n=0; previous=''
    while [ "$n" -lt 6 ]; do
        set -- $(apply_pids)
        if [ "$#" = 1 ] && [ "$1" != "$old" ]; then
            stamp=$(awk '{print $22}' "/proc/$1/stat" 2>/dev/null)
            if [ "$previous" = "$1:$stamp" ]; then
                printf '%s\n' "$1" > "$tx/live.pid"
                printf '%s\n' "$stamp" > "$tx/live.stamp"
                return 0
            fi
            previous="$1:$stamp"
        else previous=''; fi
        sleep 1; n=$((n+1))
    done
    return 1
}
apply_health() (
    health_config=$1
    # Baseline can be checked before first restart; pin the single exact process.
    if [ ! -f "$tx/live.pid" ]; then
        set -- $(apply_pids)
        [ "$#" = 1 ] || exit 1
        printf '%s\n' "$1" > "$tx/live.pid"
        awk '{print $22}' "/proc/$1/stat" > "$tx/live.stamp"
    fi
    snapshot=candidate
    [ "$health_config" != "$tx/before.conf" ] || snapshot=before
    [ "$(sha256sum "$CONF_FILE" | awk '{print $1}')" != "$(cat "$tx/before.sha")" ] || snapshot=before
    printf 'UDP\texample.org\tA\n' > "$tx/health-queries"
    # Named group reachability is tested in preflight. Live probes exercise the
    # actual nameserver routes rather than bypassing them with extra listeners.
    awk -F '\t' '$1=="ROUTE" {print "UDP\t" $4 "\tANY"}' "$tx/$snapshot.queries" >> "$tx/health-queries"
    cat "$tx/$snapshot.plan" >> "$tx/health-queries"
    start=$(date +%s)
    tab=$(printf '\t')
    while IFS="$tab" read -r kind domain expected; do
        [ "$(( $(date +%s) - start ))" -lt 25 ] || exit 1
        apply_identity || exit 1
        transport=+notcp;resolver=127.0.0.1
        case "$kind" in TCP|TCP6) transport=+tcp ;; esac
        case "$kind" in UDP6|TCP6) resolver=::1 ;; esac
        /opt/bin/timeout -k 1 3 /opt/bin/dig "@$resolver" -p 53 "$domain" A "$transport" +time=2 +tries=1 +noall +comments +answer > "$tx/answer" 2>&1 || exit 1
        cat "$tx/answer"
        if [ "$expected" = ANY ]; then grep -q -E 'status: (NOERROR|NXDOMAIN)' "$tx/answer" || exit 1
        else
            grep -q 'status: NOERROR' "$tx/answer" && grep -q '[[:space:]]A[[:space:]]' "$tx/answer" || exit 1
            if [ "$kind" = ADDRESS ]; then
                awk -v ips="$expected" 'BEGIN{n=split(ips,a,",");for(i=1;i<=n;i++)ok[a[i]]=1} $4=="A" && ($5 in ok){found=1} END{exit !found}' "$tx/answer" || exit 1
            fi
        fi
    done < "$tx/health-queries"
    apply_identity
)
apply_quiesce() { sleep 50; }
