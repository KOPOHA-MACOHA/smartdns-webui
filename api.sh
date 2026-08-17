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
    SERVICE_CMD="logger 'SmartDNS WebUI: Фейковый рестарт (TEST MODE)'"
else
    CONF_FILE="/opt/etc/smartdns/smartdns.conf"
    DOMAINS_DIR="/opt/etc/smartdns/domains/"
    LOG_FILE="/opt/var/log/smartdns/smartdns.log"
    SERVICE_CMD="/opt/etc/init.d/S*smartdns restart 2>/dev/null || systemctl restart smartdns"
fi

[ ! -f "$LOG_FILE" ] && touch "$LOG_FILE"
[ ! -d "$DOMAINS_DIR" ] && mkdir -p "$DOMAINS_DIR"

sanitize_target() {
    echo "$1" | sed 's/\///g'
}

handle_api() {
    ACTION="$1"
    TARGET=$(sanitize_target "$2")

    case "$ACTION" in
        "save_config") cat > "$CONF_FILE"; echo "OK" ;;
        "save_list") [ -n "$TARGET" ] && cat > "${DOMAINS_DIR}${TARGET}"; echo "OK" ;;
        "delete_list") [ -n "$TARGET" ] && rm -f "${DOMAINS_DIR}${TARGET}"; echo "OK" ;;
        "clear_log") > "$LOG_FILE"; echo "OK" ;;
        "restart_service") eval "$SERVICE_CMD"; echo "OK" ;;
        "get_config") cat "$CONF_FILE" 2>/dev/null ;;
        "get_lists") ls -1 "$DOMAINS_DIR" 2>/dev/null | grep '\.list$' ;;
        "get_list") [ -n "$TARGET" ] && cat "${DOMAINS_DIR}${TARGET}" 2>/dev/null ;;
        "get_log") cat "$LOG_FILE" 2>/dev/null ;;
        
        # --- БЛОК АВТООБНОВЛЕНИЯ ---
        "check_update")
            LATEST=$(curl -sL "$REPO_URL/version.txt" | tr -d '\r\n')
            if [ -n "$LATEST" ] && [ "$LATEST" != "$CURRENT_VERSION" ]; then
                echo "UPDATE_AVAILABLE|$LATEST"
            else
                echo "UP_TO_DATE"
            fi
            ;;
        "do_update")
            # Запускаем установщик в фоновом режиме, чтобы не обрывать запрос
            (curl -sL "$REPO_URL/install.sh" | sh) >/dev/null 2>&1 &
            echo "OK"
            ;;
    esac
}