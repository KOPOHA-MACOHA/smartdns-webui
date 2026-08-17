#!/bin/sh

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

    # Теперь все запросы (и GET, и POST) обрабатываются единым блоком
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
    esac
}