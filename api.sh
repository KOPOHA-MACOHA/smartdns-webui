#!/bin/sh

# Читаем версию из локального файла (BASE_DIR передается из index.cgi)
CURRENT_VERSION=$(cat "$BASE_DIR/version.txt" 2>/dev/null | tr -d '\r\n')
[ -z "$CURRENT_VERSION" ] && CURRENT_VERSION="0.0.0"
REPO_URL="https://raw.githubusercontent.com/KOPOHA-MACOHA/smartdns-webui/main"

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
    # Avoid eval and only execute an actual matching init script.
    for service_script in /opt/etc/init.d/S*smartdns; do
        if [ -f "$service_script" ] && [ -x "$service_script" ]; then
            "$service_script" restart
            return $?
        fi
    done

    if command -v systemctl >/dev/null 2>&1; then
        systemctl restart smartdns
        return $?
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
                echo "ERROR: restart_service failed"
            fi
            ;;
        "get_config")
            cat "$CONF_FILE" 2>/dev/null
            ;;
        "get_lists")
            ls -1 "$DOMAINS_DIR" 2>/dev/null | grep '\\.list$'
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
            # Проверяем версию без кэша GitHub (добавляем ?t=время)
            LATEST=$(curl -fsSL "${REPO_URL}/version.txt?t=$(date +%s)" 2>/dev/null | tr -d '\r\n')
            [ -z "$LATEST" ] && LATEST="$CURRENT_VERSION"
            echo "${CURRENT_VERSION}|${LATEST}"
            ;;
        "do_update")
            # Обновление требует отдельной проверки целостности; сохраняем
            # текущее поведение до выделенного изменения механизма обновления.
            ( sleep 2; curl -fsSL "${REPO_URL}/install.sh?t=$(date +%s)" | tr -d '\r' | sh ) >/dev/null 2>&1 &
            echo "OK"
            ;;
        *)
            echo "ERROR: unsupported action"
            ;;
    esac
}
