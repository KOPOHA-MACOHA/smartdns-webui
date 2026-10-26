#!/bin/sh
# A bounded candidate test. Never invokes init.d, killall, or writes the live config.
set -u
PATH=/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin
export PATH
umask 077
BASE_DIR=$(dirname "$(readlink -f "$0")")
candidate=${1:?candidate file required}
source_dir=${2:?source config directory required}
lock=/tmp/smartdns-webui-dns-operation.lock
work=''; child=''; child_stamp=''; launcher=''; watcher=''; launcher_stamp=''; watcher_stamp=''; owned=0
report() { printf '%s\t0\t%s\n' "$1" "$2"; }
identity() {
    [ -n "$child" ] && [ -n "$child_stamp" ] || return 1
    [ "$(readlink "/proc/$child/exe" 2>/dev/null)" = /opt/sbin/smartdns ] && same_process "$child" "$child_stamp"
}
same_process() { [ -n "$2" ] && [ "$(awk '{print $22}' "/proc/$1/stat" 2>/dev/null)" = "$2" ]; }
finish() {
    rc=$?
    trap - EXIT
    trap '' HUP INT TERM PIPE
    if [ "$rc" != 0 ] && [ -n "$work" ]; then
        if [ -f "$work/resource-error" ]; then report E "$(cat "$work/resource-error")"; fi
        grep -i -E 'error|failed|cannot|memory|resource|pthread|unsupported|invalid' "$work/launcher.log" "$work/native.log" 2>/dev/null | tail -n 4 |
            while IFS= read -r detail; do report W "SmartDNS: $detail"; done
    fi
    if [ -n "$watcher" ]; then same_process "$watcher" "$watcher_stamp" && kill "$watcher" 2>/dev/null || true; wait "$watcher" 2>/dev/null || true; fi
    if identity; then
        kill -TERM "$child" 2>/dev/null || true
        sleep 1
        identity && kill -KILL "$child" 2>/dev/null || true
    fi
    if [ -n "$launcher" ]; then same_process "$launcher" "$launcher_stamp" && kill "$launcher" 2>/dev/null || true; wait "$launcher" 2>/dev/null || true; fi
    if [ -n "$work" ]; then
        case "$work" in /opt/tmp/smartdns-preflight.*) rm -rf "$work" ;; esac
    fi
    if [ "$owned" = 1 ]; then rm -f "$lock/owner"; rmdir "$lock" 2>/dev/null || true; fi
    exit "$rc"
}
trap finish EXIT
trap 'exit 1' HUP INT TERM PIPE
version=$(/opt/sbin/smartdns -v 2>/dev/null | awk '$1=="smartdns" {print $2;exit}')
printf 'PROFILE\t%s\tpreflight\n' "${version:-unknown}"
[ "$version" = 46.1 ] || { report E 'Для этой версии ещё нет безопасного сценария нативной проверки.'; exit 1; }
if [ -n "${3:-}" ]; then
    # Only the detached apply worker can borrow its already-held mutex.
    case "$3" in /opt/var/backups/smartdns-webui/apply/tx-*) ;; *) exit 1 ;; esac
    [ "$(cat "$lock/transaction" 2>/dev/null)" = "$3" ] && [ -f "$3/armed" ] && [ ! -f "$3/abort" ] || exit 1
else
    mkdir "$lock" 2>/dev/null || { report E 'Другая проверка или операция DNS уже выполняется. Повторите позже.'; exit 1; }
    owned=1
    printf '%s\n' "$$" > "$lock/owner" || exit 1
fi
available=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
case "$available" in ''|*[!0-9]*) report E 'Не удалось проверить доступную память.'; exit 1 ;; esac
[ "$available" -ge 32768 ] || { report E 'Для отдельного SmartDNS нужно не менее 32 МБ доступной памяти. Проверка не запущена.'; exit 1; }
[ -f "$candidate" ] && [ -r "$candidate" ] || { report E 'Кандидат недоступен.'; exit 1; }
[ "$(wc -c < "$candidate")" -le 262144 ] || { report E 'Кандидат больше 256 КБ; ограниченная проверка не запущена.'; exit 1; }
for tool in /opt/bin/dig /opt/bin/timeout /opt/bin/nice; do
    [ -x "$tool" ] || { report E 'Не хватает уже установленных средств проверки (dig/timeout/nice). Пакеты автоматически не устанавливаются.'; exit 1; }
done
if netstat -ln | awk '$4 ~ /:1653[0-8]$/ {used=1} END {exit !used}'; then
    report E 'Локальные порты проверки заняты; существующие службы не затрагиваются.'; exit 1
fi
umask 077
work=$(mktemp -d /opt/tmp/smartdns-preflight.XXXXXX) || exit 1
: > "$work/sandbox.conf"; : > "$work/files"; : > "$work/probes"
if ! awk -v version=46.1 -f "$BASE_DIR/validator.awk" "$BASE_DIR/validator-46.1.txt" "$candidate" > "$work/static-report"; then
    awk '$1!="PROFILE" && $1!="FILE"' "$work/static-report"
    exit 1
fi
# Shared lexer; the static validator's record/END actions are disabled in this mode.
if ! awk -v version=46.1 -v preflight=1 -v work="$work" -f "$BASE_DIR/validator.awk" -f "$BASE_DIR/preflight-prepare.awk" "$BASE_DIR/validator-46.1.txt" "$candidate" > "$work/prepare-report"; then
    cat "$work/prepare-report"; exit 1
fi
# Preparation owns its own PROFILE header; emit diagnostics only.
sed '1d' "$work/prepare-report"
tab=$(printf '\t')
while IFS="$tab" read -r kind id path; do
    case "$id" in ''|*[!0-9]*) report E 'Неверный внутренний список проверки.'; exit 1 ;; esac
    case "$path" in /*) file=$path ;; *) file="$source_dir/$path" ;; esac
    [ -f "$file" ] && [ -r "$file" ] || { report E 'Список недоступен для создания проверочной копии.'; exit 1; }
    /opt/bin/timeout -k 1 3 dd if="$file" of="$work/list-$id" bs=4096 count=257 2>/dev/null || { report E 'Не удалось ограниченно скопировать список.'; exit 1; }
    [ "$(wc -c < "$work/list-$id")" -le 1048576 ] || { report E 'Список больше 1 МБ; нужен отдельный сценарий проверки.'; exit 1; }
done < "$work/files"
# Prepare all sample names before starting an extra process.
: > "$work/queries"
while IFS="$tab" read -r kind name port type sample; do
    if [ "$type" = LIST ]; then
        case "$sample" in ''|*[!0-9]*) report E 'Не найден список маршрута для проверки.'; exit 1 ;; esac
        sample=$(awk '{sub(/\r$/,"");sub(/^[ \t]+/,"");sub(/[ \t]+$/,"");if($0~/^[A-Za-z0-9][A-Za-z0-9.-]*$/ && length($0)<=253){print;exit}}' "$work/list-$sample")
    fi
    case "$sample" in ''|*[!A-Za-z0-9.-]*|-*) report E 'Не удалось выбрать безопасный DNS-домен для проверки маршрута.'; exit 1 ;; esac
    printf '%s\t%s\t%s\t%s\n' "$kind" "$name" "$port" "$sample" >> "$work/queries"
done < "$work/probes"
# Child resource limits are not inherited by the working SmartDNS.
(
    trap - EXIT HUP INT TERM
    cd "$work" || exit 1
    ulimit -v 98304 || exit 1
    ulimit -t 8 || exit 1
    ulimit -n 256 || exit 1
    ulimit -c 0 || exit 1
    exec /opt/bin/timeout -k 2 30 /opt/bin/nice -n 10 /opt/sbin/smartdns -f -c "$work/sandbox.conf" -p "$work/instance.pid"
) > "$work/launcher.log" 2>&1 &
launcher=$!
launcher_stamp=$(awk '{print $22}' "/proc/$launcher/stat" 2>/dev/null)
tries=0
while [ "$tries" -lt 4 ]; do
    if [ -s "$work/instance.pid" ]; then
        proposed=$(cat "$work/instance.pid")
        case "$proposed" in ''|*[!0-9]*) ;; *)
            if [ "$(awk '{print $4}' "/proc/$proposed/stat" 2>/dev/null)" = "$launcher" ] && [ "$(readlink "/proc/$proposed/exe" 2>/dev/null)" = /opt/sbin/smartdns ]; then
                child=$proposed
                child_stamp=$(awk '{print $22}' "/proc/$child/stat" 2>/dev/null)
                identity && break
            fi ;;
        esac
    fi
    kill -0 "$launcher" 2>/dev/null || break
    sleep 1; tries=$((tries+1))
done
identity || { report E 'Проверочный SmartDNS не запустился с отдельным PID. Рабочая служба не перезапускалась.'; exit 1; }
(
    trap - EXIT HUP INT TERM
    while identity; do
        rss=$(awk '/^VmRSS:/ {print $2}' "/proc/$child/status" 2>/dev/null)
        free=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
        if [ "${rss:-0}" -gt 16384 ] || [ "${free:-0}" -lt 8192 ]; then
            echo 'Проверка остановлена: превышен лимит RSS 16 МБ или мало свободной памяти.' > "$work/resource-error"
            identity && kill -TERM "$child" 2>/dev/null || true
            break
        fi
        sleep 1
    done
) &
watcher=$!
watcher_stamp=$(awk '{print $22}' "/proc/$watcher/stat" 2>/dev/null)
started=$(date +%s)
probe() {
    domain=$1; port=$2; transport=$3; expected=${4:-}
    identity || return 1
    [ ! -f "$work/resource-error" ] || return 1
    [ "$(( $(date +%s) - started ))" -lt 25 ] || return 1
    if [ "$transport" = tcp ]; then tcp=+tcp; else tcp=+notcp; fi
    /opt/bin/timeout -k 1 3 /opt/bin/dig @127.0.0.1 -p "$port" "$domain" A "$tcp" +time=2 +tries=1 +noall +comments +answer > "$work/answer" 2>&1 || return 1
    grep -q -E 'status: (NOERROR|NXDOMAIN)' "$work/answer" || return 1
    if [ -n "$expected" ]; then
        grep -q 'status: NOERROR' "$work/answer" || return 1
        grep -q '[[:space:]]A[[:space:]]' "$work/answer" || return 1
        [ "$expected" = A ] || grep -q "$expected" "$work/answer"
    fi
    return 0
}
ready=0;tries=0
while [ "$tries" -lt 3 ]; do
    if probe webui-preflight.invalid 16530 udp '192\.0\.2\.123'; then ready=1;break;fi
    identity || break
    tries=$((tries+1));sleep 1
done
[ "$ready" = 1 ] || { report E 'Не отвечает именно проверочный экземпляр на отдельном порту.'; exit 1; }
probe webui-preflight.invalid 16530 tcp '192\.0\.2\.123' || { report E 'Проверочный экземпляр не отвечает по TCP.'; exit 1; }
report I 'Отдельный экземпляр запущен, его UDP/TCP-ответы подтверждены.'
report I 'Лимиты: 30 с процесса, 25 с запросов, 8 с CPU; RSS контролируется с порогом 16 МБ. Кэш ответов на проверочных портах отключён.'
check_queries() {
    failed=0
    : > "$work/retry-queries"
    while IFS="$tab" read -r kind name port domain; do
        expected=''
        [ "$kind:$name" != GROUP:default ] || expected=A
        if probe "$domain" "$port" udp "$expected"; then
            if [ "$kind" = GROUP ]; then report I "Группа $name: допустимый DNS-ответ для $domain получен."; else report I "Маршрут $domain → $name: допустимый DNS-ответ получен."; fi
        else
            printf '%s\t%s\t%s\t%s\n' "$kind" "$name" "$port" "$domain" >> "$work/retry-queries"
            report I "Ответ $domain ($kind, группа $name) пока не получен; повторим после остальных запросов в пределах общего лимита."
        fi
    done < "$work/queries"
    while IFS="$tab" read -r kind name port domain; do
        expected=''
        [ "$kind:$name" != GROUP:default ] || expected=A
        if probe "$domain" "$port" udp "$expected"; then
            report I "Повторная проверка $domain ($kind, группа $name): допустимый DNS-ответ получен."
        else
            report E "Не подтверждён ответ $domain ($kind, группа $name). Возможны сеть, bootstrap, правила или истечение лимита."
            failed=1
        fi
    done < "$work/retry-queries"
}
check_queries
if grep -i -q -E 'process config failed|unsupported config|invalid parameter|load config failed' "$work/launcher.log" "$work/native.log"; then
    report E 'SmartDNS сообщил об ошибке разбора проверочной копии.'; failed=1
fi
if [ -f "$work/resource-error" ]; then report E "$(cat "$work/resource-error")"; failed=1; fi
identity || { report E 'Проверочный процесс завершился до окончания теста.'; failed=1; }
[ "$failed" = 0 ] || exit 1
peak=$(awk '/^VmHWM:/ {print $2}' "/proc/$child/status" 2>/dev/null)
[ -z "$peak" ] || report I "Пиковый RSS проверочного SmartDNS: $peak КБ."
report I 'Проверка завершена. Рабочий DNS-файл и процесс не изменялись; временный экземпляр останавливается.'
if [ -n "${3:-}" ]; then
    case "${4:-}" in before|candidate) ;; *) exit 1 ;; esac
    cp "$work/queries" "$3/$4.queries" || exit 1
    : > "$3/$4.inputs"
    while IFS="$tab" read -r kind id path; do
        case "$path" in /*) file=$path ;; *) file="$source_dir/$path" ;; esac
        original=$(sha256sum "$file"); original=${original%% *}
        copied=$(sha256sum "$work/list-$id"); copied=${copied%% *}
        [ "$original" = "$copied" ] || { report E 'Список изменился во время проверки.'; exit 1; }
        printf '%s\t%s\n' "$original" "$file" >> "$3/$4.inputs" || exit 1
    done < "$work/files"
fi
exit 0
