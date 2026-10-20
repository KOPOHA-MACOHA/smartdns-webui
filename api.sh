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

handle_api() {
    ACTION="$1"
    TARGET="$2"

    case "$ACTION" in
        "save_config")
            if atomic_save "$CONF_FILE"; then echo "OK"; else echo "ERROR: save_config failed"; fi
            ;;
        "save_list")
            if ! valid_list_target "$TARGET"; then
                echo "ERROR: invalid list filename"
            elif atomic_save "${DOMAINS_DIR}${TARGET}"; then
                echo "OK"
            else
                echo "ERROR: save_list failed"
            fi
            ;;
        "delete_list")
            if ! valid_list_target "$TARGET"; then
                echo "ERROR: invalid list filename"
            elif [ -f "${DOMAINS_DIR}${TARGET}" ] && rm -f "${DOMAINS_DIR}${TARGET}"; then
                echo "OK"
            elif [ ! -e "${DOMAINS_DIR}${TARGET}" ]; then
                echo "ERROR: list not found"
            else
                echo "ERROR: delete_list failed"
            fi
            ;;
        "clear_log")
            if : > "$LOG_FILE"; then echo "OK"; else echo "ERROR: clear_log failed"; fi
            ;;
        "restart_service")
            if [ "$TEST_MODE" = "1" ]; then
                logger 'SmartDNS WebUI: Фейковый рестарт (TEST MODE)'
                echo "OK"
            elif restart_smartdns; then
                echo "OK"
            else
                echo "ERROR: SmartDNS restart was not confirmed. See /opt/var/log/smartdns-webui-service.log"
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
