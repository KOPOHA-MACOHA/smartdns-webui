#!/bin/sh

# Читаем версию из локального файла (BASE_DIR передается из index.cgi)
CURRENT_VERSION=$(cat "$BASE_DIR/version.txt" 2>/dev/null | tr -d '\r\n')
[ -z "$CURRENT_VERSION" ] && CURRENT_VERSION="0.0.0"
REPO_URL="https://raw.githubusercontent.com/KOPOHA-MACOHA/smartdns-webui/main"

# Accept only numeric MAJOR.MINOR.PATCH versions.
version_is_valid() {
    printf '%s\n' "$1" | awk -F. 'NF == 3 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ { exit 0 } { exit 1 }'
}

# Return success only when latest is strictly newer than current.
version_is_newer() {
    version_is_valid "$1" && version_is_valid "$2" || return 1
    awk -v current="$1" -v latest="$2" 'BEGIN {
        split(current, c, ".")
        split(latest, l, ".")
        for (i = 1; i <= 3; i++) {
            if ((l[i] + 0) > (c[i] + 0)) exit 0
            if ((l[i] + 0) < (c[i] + 0)) exit 1
        }
        exit 1
    }'
}

TEST_MODE="$HTTP_X_TEST_MODE"

if [ "$TEST_MODE" = "1" ]; then
    CONF_FILE="/opt/tmp/smartdns_test.conf"
    DOMAINS_DIR="/opt/tmp/domains_test/"
    LOG_FILE="/opt/tmp/smartdns_test.log"
else
    CONF_FILE="/opt/etc/smartdns/smartdns.conf"
    DOMAINS_DIR="/opt/etc/smartdns/domains/"
    LOG_FILE="/opt/var/log/smartdns/smartdns.log"
fi

[ ! -f "$LOG_FILE" ] && touch "$LOG_FILE" 2>/dev/null
[ ! -d "$DOMAINS_DIR" ] && mkdir -p "$DOMAINS_DIR" 2>/dev/null

# Accept only simple list filenames. Never allow slashes, traversal, or
# unexpected characters from the HTTP_X_TARGET header.
valid_list_target() {
    case "$1" in
        ""| "." | ".." | *[!A-Za-z0-9_.-]* | */*) return 1 ;;
        *.list) return 0 ;;
        *) return 1 ;;
    esac
}

# Write to a temporary file in the same directory, then atomically replace
# the destination. Keep a copy of the previous file before replacing it.
atomic_save() {
    target_file="$1"
    temp_file="${target_file}.tmp.$$"
    backup_file="${target_file}.bak"

    umask 077
    if ! cat > "$temp_file"; then
        rm -f "$temp_file"
        return 1
    fi

    # SmartDNS and the web UI need readable configuration/list files.
    chmod 644 "$temp_file" || {
        rm -f "$temp_file"
        return 1
    }

    if [ -f "$target_file" ]; then
        cp -p "$target_file" "$backup_file" || {
            rm -f "$temp_file"
            return 1
        }
    fi

    if ! mv -f "$temp_file" "$target_file"; then
        rm -f "$temp_file"
        return 1
    fi
    return 0
}

restart_smartdns() {
    # Keep service output out of the CGI response. Retain only the latest
    # restart log so repeated clicks cannot grow this file without bound.
    mkdir -p /opt/var/log 2>/dev/null || true
    SERVICE_LOG="/opt/var/log/smartdns-webui-service.log"
    : > "$SERVICE_LOG" 2>/dev/null || SERVICE_LOG="/dev/null"

    service_log() {
        printf '[%s] %s\n' "$(date)" "$*" >> "$SERVICE_LOG"
    }

    OLD_PID="$(pidof smartdns 2>/dev/null || true)"
    service_log "Previous SmartDNS PID: ${OLD_PID:-not running}"
    RESTART_RC=1
    SERVICE_FOUND=0

    for service_script in /opt/etc/init.d/S*smartdns; do
        if [ -f "$service_script" ] && [ -x "$service_script" ]; then
            SERVICE_FOUND=1
            service_log "Running: $service_script restart"
            "$service_script" restart >> "$SERVICE_LOG" 2>&1
            RESTART_RC=$?
            break
        fi
    done

    if [ "$SERVICE_FOUND" -eq 0 ] && command -v systemctl >/dev/null 2>&1; then
        SERVICE_FOUND=1
        service_log "Running: systemctl restart smartdns"
        systemctl restart smartdns >> "$SERVICE_LOG" 2>&1
        RESTART_RC=$?
    fi

    if [ "$SERVICE_FOUND" -eq 0 ]; then
        service_log "ERROR: no SmartDNS service script found"
        return 1
    fi

    # A successful exit code alone is not enough: wait up to 5 seconds
    # for the SmartDNS process to appear after the restart.
    WAIT=0
    NEW_PID=""
    while [ "$WAIT" -lt 5 ]; do
        NEW_PID="$(pidof smartdns 2>/dev/null || true)"
        [ -n "$NEW_PID" ] && break
        sleep 1
        WAIT=$((WAIT + 1))
    done

    if [ "$RESTART_RC" -ne 0 ]; then
        service_log "ERROR: restart command exited with code $RESTART_RC; process after restart: ${NEW_PID:-not running}"
        return 1
    fi

    if [ -z "$NEW_PID" ]; then
        service_log "ERROR: SmartDNS process did not appear after restart"
        return 1
    fi

    if [ -n "$OLD_PID" ] && [ "$NEW_PID" = "$OLD_PID" ]; then
        service_log "ERROR: SmartDNS PID did not change (before: $OLD_PID; after: $NEW_PID)"
        return 1
    fi

    service_log "SUCCESS: restart command exited 0; SmartDNS process is running; PID: $NEW_PID"
    return 0
}

acquire_update_lock() {
    UPDATE_LOCK="/opt/tmp/smartdns-webui-update.lock"
    if mkdir "$UPDATE_LOCK" 2>/dev/null; then
        # Publish the request owner's PID immediately, closing the window
        # where a concurrent request could mistake a newly-created lock
        # for an abandoned one.
        printf '%s\n' "$$" > "$UPDATE_LOCK/pid" || {
            rm -rf "$UPDATE_LOCK"
            return 1
        }
        return 0
    fi

    # Recover a lock left behind after a crashed/rebooted updater.
    OLD_PID=$(cat "$UPDATE_LOCK/pid" 2>/dev/null || true)
    if [ -n "$OLD_PID" ] && ! kill -0 "$OLD_PID" 2>/dev/null; then
        rm -rf "$UPDATE_LOCK"
        if mkdir "$UPDATE_LOCK" 2>/dev/null; then
            printf '%s\n' "$$" > "$UPDATE_LOCK/pid" || {
                rm -rf "$UPDATE_LOCK"
                return 1
            }
            return 0
        fi
        return 1
    fi

    # A crash can occur between mkdir and writing the PID. Only reclaim a
    # PID-less lock after it has aged enough to avoid racing the creator.
    if [ -z "$OLD_PID" ]; then
        LOCK_MTIME=$(stat -c '%Y' "$UPDATE_LOCK" 2>/dev/null || true)
        NOW=$(date +%s 2>/dev/null || true)
        case "$LOCK_MTIME:$NOW" in
            *[!0-9:]*|:*) ;;
            *)
                if [ "$((NOW - LOCK_MTIME))" -ge 300 ]; then
                    rm -rf "$UPDATE_LOCK"
                    if mkdir "$UPDATE_LOCK" 2>/dev/null; then
                        printf '%s\n' "$$" > "$UPDATE_LOCK/pid" || {
                            rm -rf "$UPDATE_LOCK"
                            return 1
                        }
                        return 0
                    fi
                fi
                ;;
        esac
    fi
    return 1
}

validate_config_file() (
    candidate=$1
    [ -r "$BASE_DIR/validator.awk" ] && [ -r "$BASE_DIR/validator-46.1.txt" ] || {
        printf 'E\t0\tФайлы серверного валидатора недоступны.\n'; exit 1;
    }
    version=$(/opt/sbin/smartdns -v 2>/dev/null | awk '$1=="smartdns" {print $2; exit}')
    [ "$TEST_MODE" != 1 ] || version=${VALIDATOR_TEST_VERSION:-$version}
    [ -n "$version" ] || version=unknown
    result=$(mktemp "${candidate}.validation.XXXXXX") || exit 1
    trap 'rm -f "$result"' EXIT
    rc=0
    awk -v version="$version" -f "$BASE_DIR/validator.awk" "$BASE_DIR/validator-46.1.txt" "$candidate" > "$result" || rc=$?
    [ "$rc" -le 1 ] || { printf 'E\t0\tОшибка выполнения серверного валидатора.\n'; exit 1; }
    tab=$(printf '\t')
    while IFS="$tab" read -r level line message; do
        if [ "$level" = FILE ]; then
            case "$message" in
                /*) file=$message ;;
                *) file="$(dirname "$CONF_FILE")/$message" ;;
            esac
            case "$file" in
                *\**|*\?*|*\[* ) printf 'W\t%s\tШаблон пути списка не проверен: %s\n' "$line" "$message" ;;
                *) if [ ! -f "$file" ] || [ ! -r "$file" ]; then
                    printf 'E\t%s\tФайл списка недоступен: %s\n' "$line" "$message"
                    rc=1
                fi ;;
            esac
        else printf '%s\t%s\t%s\n' "$level" "$line" "$message"; fi
    done < "$result"
    exit "$rc"
)

validate_config_request() (
    umask 077
    candidate=$(mktemp "${CONF_FILE}.check.XXXXXX") || { printf 'E\t0\tНе удалось создать временный файл проверки.\n'; exit 1; }
    trap 'rm -f "$candidate"' EXIT
    cat > "$candidate" || exit 1
    validate_config_file "$candidate"
)

preflight_config_request() (
    umask 077
    candidate=$(mktemp "${CONF_FILE}.preflight.XXXXXX") || exit 1
    result="${candidate}.result"
    trap 'rm -f "$candidate" "$result"' EXIT
    cat > "$candidate" || exit 1
    if [ "$(wc -c < "$candidate")" -gt 262144 ]; then
        printf 'PROFILE\t46.1\tpreflight\nE\t0\tКандидат больше 256 КБ; проверка не запущена.\n'; exit 1
    fi
    rc=0
    /opt/bin/timeout -k 3 45 /opt/bin/nice -n 10 /bin/sh "$BASE_DIR/preflight.sh" "$candidate" "$(dirname "$CONF_FILE")" > "$result" 2>/dev/null || rc=$?
    cat "$result"
    if [ "$rc" != 0 ] && ! grep -q "^E$(printf '\t')" "$result"; then
        printf 'E\t0\tНативная проверка не завершилась успешно или превысила лимит времени. Рабочий DNS не менялся.\n'
    fi
    exit "$rc"
)

guarded_restart() (
    umask 077
    lock=/tmp/smartdns-webui-dns-operation.lock
    mkdir "$lock" 2>/dev/null || { echo 'BUSY: DNS test or service operation in progress'; exit 1; }
    trap 'rm -f "$lock/owner"; rmdir "$lock"' EXIT
    trap 'exit 1' HUP INT TERM
    printf '%s\n' "$$" > "$lock/owner" || exit 1
    restart_smartdns
)

config_hash() {
    hash_output=$(sha256sum "$1") || return 1
    printf '%s\n' "${hash_output%% *}"
}

# Hash and content must describe the same copy, even during another writer's rename.
config_snapshot() (
    umask 077
    snapshot=$(mktemp "${CONF_FILE}.read.XXXXXX") || { echo 'ERROR: snapshot'; exit 1; }
    trap 'rm -f "$snapshot"' EXIT
    cp "$CONF_FILE" "$snapshot" || { echo 'ERROR: read config'; exit 1; }
    revision=$(config_hash "$snapshot") || exit 1
    printf 'REVISION %s\n' "$revision"
    cat "$snapshot"
)

# All WebUI writers share this lock. External writers are detected by checksum;
# external tools must cooperate with the lock for a fully atomic compare-and-swap.
guarded_config_save() (
    umask 077
    expected=${HTTP_X_CONFIG_REVISION:-}
    case "$expected" in ''|*[!0-9a-f]*) echo 'ERROR: missing or invalid revision'; exit 1 ;; esac
    [ "${#expected}" = 64 ] || { echo 'ERROR: invalid revision'; exit 1; }
    lock="${CONF_FILE}.webui-lock"
    mkdir "$lock" 2>/dev/null || { echo 'BUSY: another save is in progress'; exit 1; }
    temp=''
    trap '[ -z "$temp" ] || rm -f "$temp"; rmdir "$lock"' EXIT
    trap 'exit 1' HUP INT TERM
    [ -f "$CONF_FILE" ] && [ ! -L "$CONF_FILE" ] || { echo 'ERROR: config is missing or is a symlink'; exit 1; }
    current=$(config_hash "$CONF_FILE") || exit 1
    [ "$expected" = "$current" ] || { echo 'CONFLICT: config has changed; reload before saving'; exit 1; }
    temp=$(mktemp "${CONF_FILE}.write.XXXXXX") || { echo 'ERROR: temporary file'; exit 1; }
    cp -p "$CONF_FILE" "$temp" || { echo 'ERROR: preserve config permissions'; exit 1; }
    cat > "$temp" || { echo 'ERROR: write temporary file'; exit 1; }
    validation=$(validate_config_file "$temp") || {
        printf 'VALIDATION_FAILED\n%s\n' "$validation"; exit 1;
    }
    new_revision=$(config_hash "$temp") || exit 1
    if [ "$new_revision" = "$expected" ]; then printf 'OK\nREVISION %s\n' "$expected"; exit 0; fi
    if [ "$TEST_MODE" = 1 ]; then
        backup_dir="${CONFIG_BACKUP_DIR:-/opt/tmp/smartdns-webui-test-backups}"
    else
        backup_dir=/opt/var/backups/smartdns-webui/config
    fi
    mkdir -p "$backup_dir" || { echo 'ERROR: backup directory'; exit 1; }
    backup=$(mktemp "$backup_dir/config-$(date +%Y%m%d-%H%M%S).XXXXXX") || { echo 'ERROR: backup file'; exit 1; }
    if ! cp "$CONF_FILE" "$backup" || [ "$(config_hash "$backup")" != "$expected" ]; then
        rm -f "$backup"
        echo 'CONFLICT: could not back up expected config'; exit 1
    fi
    [ "$(config_hash "$CONF_FILE")" = "$expected" ] || { echo 'CONFLICT: config changed during save'; exit 1; }
    mv -f "$temp" "$CONF_FILE" || { echo 'ERROR: atomic replacement'; exit 1; }
    temp=''
    printf 'OK\nREVISION %s\nBACKUP %s\n' "$new_revision" "$backup"
    # Keep the 20 latest copies; names are generated above, never supplied by HTTP.
    ls -1t "$backup_dir"/config-* 2>/dev/null | (
        count=1
        while IFS= read -r old_backup; do
            [ "$old_backup" = "$backup" ] && continue
            count=$((count + 1))
            [ "$count" -le 20 ] || rm -f "$old_backup"
        done
    )
)

guarded_list_request() (
    valid_list_target "$2" || { echo 'ERROR: invalid list filename'; exit 1; }
    lock="$CONF_FILE.webui-lock"
    mkdir "$lock" 2>/dev/null || { echo 'BUSY: configuration operation in progress'; exit 1; }
    trap 'rmdir "$lock"' EXIT
    [ ! -d /tmp/smartdns-webui-dns-operation.lock ] || { echo 'BUSY: DNS operation in progress'; exit 1; }
    case "$1" in
        save) atomic_save "${DOMAINS_DIR}$2" || { echo 'ERROR: save_list failed'; exit 1; } ;;
        delete) [ -f "${DOMAINS_DIR}$2" ] && rm -f "${DOMAINS_DIR}$2" || { echo 'ERROR: delete_list failed'; exit 1; } ;;
        *) exit 1 ;;
    esac
    echo OK
)

apply_request() (
    umask 077
    [ "$TEST_MODE" != 1 ] || { echo 'ERROR: apply disabled in UI test mode'; exit 1; }
    # Feature activation is explicit; delivery of UI files alone cannot enable it.
    [ -f /opt/etc/smartdns/webui-safe-apply.enabled ] || { echo 'ERROR: safe apply has not been enabled on this router'; exit 1; }
    expected=${HTTP_X_CONFIG_REVISION:-}
    case "$expected" in ''|*[!0-9a-f]*) echo 'ERROR: invalid revision'; exit 1 ;; esac
    [ "${#expected}" = 64 ] || exit 1
    [ -f "$CONF_FILE" ] && [ ! -L "$CONF_FILE" ] || exit 1
    [ "$(wc -c < "$CONF_FILE")" -le 262144 ] || { echo 'ERROR: baseline exceeds 256 KiB'; exit 1; }
    lock=/tmp/smartdns-webui-dns-operation.lock
    mkdir "$lock" 2>/dev/null || { echo 'BUSY: DNS operation in progress'; exit 1; }
    handed=0; config_locked=0; tx=''
    cleanup_apply_request() {
        if [ "$handed" = 0 ]; then
            rm -f "$lock/owner" "$lock/transaction"; rmdir "$lock" 2>/dev/null || true
            [ "$config_locked" = 0 ] || rmdir "$CONF_FILE.webui-lock" 2>/dev/null || true
        fi
    }
    trap cleanup_apply_request EXIT
    trap 'exit 1' HUP INT TERM
    mkdir "$CONF_FILE.webui-lock" 2>/dev/null || { echo 'BUSY: configuration save in progress'; exit 1; }
    config_locked=1
    root=/opt/var/backups/smartdns-webui/apply
    mkdir -p "$root" && chmod 700 "$root" || exit 1
    # Refuse unresolved journals, including those surviving a reboot.
    for journal in "$root"/tx-*/status; do
        [ -f "$journal" ] || continue
        case "$(cat "$journal")" in COMMITTED|ROLLED_BACK|REJECTED) ;; *) echo 'ERROR: unresolved apply journal; inspect through SSH'; exit 1 ;; esac
    done
    count=$(find "$root" -mindepth 1 -maxdepth 1 -type d | wc -l)
    [ "$count" -lt 20 ] || { echo 'ERROR: apply history limit reached; archive journals through SSH'; exit 1; }
    tx=$(mktemp -d "$root/tx-XXXXXXXXXXXX") || exit 1
    cp -p "$CONF_FILE" "$tx/candidate" && cat > "$tx/candidate" || exit 1
    [ "$(wc -c < "$tx/candidate")" -le 262144 ] || { echo 'ERROR: candidate exceeds 256 KiB'; exit 1; }
    validation=$(validate_config_file "$tx/candidate") || { printf 'VALIDATION_FAILED\n%s\n' "$validation"; exit 1; }
    cp -p "$CONF_FILE" "$tx/before.conf" || exit 1
    [ "$(config_hash "$tx/before.conf")" = "$expected" ] && [ "$(config_hash "$CONF_FILE")" = "$expected" ] || { echo 'CONFLICT: configuration changed'; exit 1; }
    # Restrict sensitive snapshots, preserve original mode separately for installation.
    cp -p "$CONF_FILE" "$tx/mode-reference" && : > "$tx/mode-reference" || exit 1
    chmod 600 "$tx/before.conf" "$tx/candidate" || exit 1
    printf '%s\n' "$expected" > "$tx/before.sha"
    config_hash "$tx/candidate" > "$tx/candidate.sha"
    printf '%s\n' "$(( $(date +%s) + 180 ))" > "$tx/deadline"
    printf 'ARMING\n' > "$tx/status"
    printf '%s\n' "$tx" > "$lock/transaction"
    # Transfer responsibility BEFORE launching: the CGI must never remove guard locks.
    handed=1
    nohup /bin/sh "$BASE_DIR/apply.sh" guard "$tx" </dev/null > "$tx/guard.log" 2>&1 &
    guard=$!
    n=0
    while [ ! -f "$tx/armed" ] && [ "$n" -lt 4 ]; do sleep 1; n=$((n+1)); done
    [ -f "$tx/armed" ] && kill -0 "$guard" 2>/dev/null || { echo 'ERROR: rollback guard not armed; inspect journal'; exit 1; }
    nohup /bin/sh "$BASE_DIR/apply.sh" worker "$tx" </dev/null > "$tx/worker.log" 2>&1 &
    worker=$!
    printf '%s\n' "$worker" > "$tx/worker.pid"
    awk '{print $22}' "/proc/$worker/stat" > "$tx/worker.stamp"
    printf 'OK\nTRANSACTION %s\n' "${tx##*/}"
)

apply_control() (
    [ "$TEST_MODE" != 1 ] || { echo 'ERROR: apply disabled in UI test mode'; exit 1; }
    id=${1:-}
    case "$id" in tx-????????????) ;; *) echo 'ERROR: invalid transaction'; exit 1 ;; esac
    case "$id" in *[!A-Za-z0-9-]*) exit 1 ;; esac
    tx="/opt/var/backups/smartdns-webui/apply/$id"
    [ -d "$tx" ] && [ ! -L "$tx" ] && [ -f "$tx/status" ] || { echo 'ERROR: transaction not found'; exit 1; }
    case "$2" in
        confirm)
            [ "$(cat "$tx/status")" = AWAITING_CONFIRMATION ] && [ -f "$tx/healthy" ] && [ "$(date +%s)" -lt "$(cat "$tx/deadline")" ] || { echo 'ERROR: not awaiting confirmation'; exit 1; }
            touch "$tx/confirm" || exit 1 ;;
        abort) touch "$tx/abort" || exit 1 ;;
    esac
    printf 'STATUS %s\nDEADLINE %s\n' "$(cat "$tx/status")" "$(cat "$tx/deadline")"
)

handle_api() {
    ACTION="${1:-}"
    TARGET="${2:-}"

    case "$ACTION" in
        "get_active_apply")
            transaction=$(cat /tmp/smartdns-webui-dns-operation.lock/transaction 2>/dev/null || true)
            case "$transaction" in
                /opt/var/backups/smartdns-webui/apply/tx-*) printf 'TRANSACTION %s\n' "${transaction##*/}" ;;
                *) echo NONE ;;
            esac ;;
        "apply_config") apply_request ;;
        "get_apply_status") apply_control "$TARGET" status ;;
        "confirm_apply") apply_control "$TARGET" confirm ;;
        "abort_apply") apply_control "$TARGET" abort ;;
        "preflight_config")
            preflight_config_request
            ;;
        "validate_config")
            validate_config_request
            ;;
        "save_config")
            guarded_config_save
            ;;
        "get_config_snapshot")
            config_snapshot
            ;;
        "save_list")
            guarded_list_request save "$TARGET"
            ;;
        "delete_list")
            guarded_list_request delete "$TARGET"
            ;;
        "clear_log")
            if : > "$LOG_FILE"; then echo "OK"; else echo "ERROR: clear_log failed"; fi
            ;;
        "restart_service")
            if [ "$TEST_MODE" = "1" ]; then
                logger 'SmartDNS WebUI: Фейковый рестарт (TEST MODE)'
                echo "OK"
            else
                echo "ERROR: use guarded apply_config; unguarded restart is disabled"
            fi
            ;;
        "get_config")
            cat "$CONF_FILE" 2>/dev/null
            ;;
        "get_lists")
            ls -1 "$DOMAINS_DIR" 2>/dev/null | grep '\.list$'
            ;;
        "get_list")
            if valid_list_target "$TARGET"; then
                cat "${DOMAINS_DIR}${TARGET}" 2>/dev/null
            else
                echo "ERROR: invalid list filename"
            fi
            ;;
        "get_clients")
            # Read only on an explicit journal refresh; no daemon or polling.
            clients=$(curl -fsS --connect-timeout 1 --max-time 3 --max-filesize 262144 http://127.0.0.1:79/rci/show/ip/hotspot 2>/dev/null) || {
                echo 'ERROR: Keenetic client directory unavailable'; return 0;
            }
            case "$clients" in *'"host"'*) ;; *) echo 'ERROR: invalid client directory'; return 0 ;; esac
            printf '{"hotspot":%s,"neighbors":[' "$clients"
            ip -6 neigh show 2>/dev/null | awk '
                $1 ~ /^[0-9a-fA-F:]+$/ { for(i=2;i<NF;i++) if($i=="lladdr" && $(i+1) ~ /^[0-9a-fA-F:]+$/) {
                    printf "%s{\"ip\":\"%s\",\"mac\":\"%s\"}", sep, $1, $(i+1); sep=","; break
                }}'
            printf '],"router":['
            ip -o addr show 2>/dev/null | awk '
                {split($4,a,"/");if(a[1] ~ /^[0-9a-fA-F:.]+$/) {printf "%s\"%s\"", sep,a[1];sep=","}}'
            printf ']}\n'
            ;;
        "get_log")
            cat "$LOG_FILE" 2>/dev/null
            ;;
        "get_update")
            # Проверяем версию без кэша GitHub и игнорируем некорректный ответ.
            LATEST=$(curl -fsSL "${REPO_URL}/version.txt?t=$(date +%s)" 2>/dev/null | tr -d '\r\n')
            version_is_valid "$LATEST" || LATEST="$CURRENT_VERSION"
            echo "${CURRENT_VERSION}|${LATEST}"
            ;;
        "get_update_status")
            UPDATE_STATUS="/opt/tmp/smartdns-webui-update.status"
            if [ -f "$UPDATE_STATUS" ]; then
                cat "$UPDATE_STATUS"
            else
                echo "IDLE"
            fi
            ;;
        "do_update")
            if [ "$TEST_MODE" = "1" ]; then
                echo "ERROR: update disabled in test mode"
            elif ! version_is_valid "$CURRENT_VERSION"; then
                echo "ERROR: installed version is invalid; refusing update"
            elif ! LATEST=$(curl -fsSL "${REPO_URL}/version.txt?t=$(date +%s)" 2>/dev/null | tr -d '\r\n') || ! version_is_valid "$LATEST" || ! version_is_newer "$CURRENT_VERSION" "$LATEST"; then
                echo "ERROR: no newer valid version available; refusing update"
            elif ! mkdir -p /opt/tmp /opt/var/log 2>/dev/null; then
                echo "ERROR: cannot create update directories"
            elif ! acquire_update_lock; then
                echo "ERROR: update already running"
            else
                UPDATE_STATUS="/opt/tmp/smartdns-webui-update.status"
                UPDATE_LOCK="/opt/tmp/smartdns-webui-update.lock"
                UPDATE_TMP="/opt/tmp/smartdns-webui-update-installer.tmp"
                UPDATE_LOG="/opt/var/log/smartdns-webui-update.log"
                printf 'RUNNING\n' > "${UPDATE_STATUS}.tmp" &&
                    mv -f "${UPDATE_STATUS}.tmp" "$UPDATE_STATUS" || {
                        rm -rf "$UPDATE_LOCK"
                        echo "ERROR: cannot write update status"
                        return 1
                    }
                (
                    set -u
                    finish_update() {
                        rc=$?
                        if [ "$rc" -ne 0 ]; then
                            printf 'ERROR\n' > "${UPDATE_STATUS}.tmp"
                            mv -f "${UPDATE_STATUS}.tmp" "$UPDATE_STATUS"
                        fi
                        rm -rf "$UPDATE_LOCK"
                    }
                    trap finish_update EXIT
                    echo "[$(date)] Update started" > "$UPDATE_LOG"
                    if ! curl -fsSL --connect-timeout 15 --max-time 120 "${REPO_URL}/install.sh?t=$(date +%s)" -o "$UPDATE_TMP"; then
                        echo "[$(date)] ERROR: installer download failed" >> "$UPDATE_LOG"
                        rm -f "$UPDATE_TMP"
                        exit 1
                    fi
                    if [ ! -s "$UPDATE_TMP" ] || ! sh -n "$UPDATE_TMP"; then
                        echo "[$(date)] ERROR: installer is empty or has shell syntax errors" >> "$UPDATE_LOG"
                        rm -f "$UPDATE_TMP"
                        exit 1
                    fi
                    if sh "$UPDATE_TMP" >> "$UPDATE_LOG" 2>&1; then
                        echo "[$(date)] Update completed successfully" >> "$UPDATE_LOG"
                        printf 'SUCCESS\n' > "${UPDATE_STATUS}.tmp"
                        mv -f "${UPDATE_STATUS}.tmp" "$UPDATE_STATUS"
                    else
                        echo "[$(date)] ERROR: update failed" >> "$UPDATE_LOG"
                        rm -f "$UPDATE_TMP"
                        exit 1
                    fi
                    rm -f "$UPDATE_TMP"
                ) </dev/null >/dev/null 2>&1 &
                UPDATER_PID=$!
                printf '%s\n' "$UPDATER_PID" > "$UPDATE_LOCK/pid" 2>/dev/null || true
                echo "OK"
            fi
            ;;
        *)
            echo "ERROR: unsupported action"
            ;;
    esac
}
