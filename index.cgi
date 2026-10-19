#!/bin/sh
export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"

BASE_DIR=$(dirname "$(readlink -f "$0")")

# Authenticate against the existing Entware root password hash. Never create or
# store a second WebUI password. Entware's default BusyBox passwd uses MD5-crypt
# on many builds; SHA-256/SHA-512 crypt are supported where OpenSSL supports them.
authenticate_entware_root() {
    AUTH_HEADER=${HTTP_AUTHORIZATION:-}
    case "$AUTH_HEADER" in
        Basic\ *) ;;
        *) return 1 ;;
    esac

    CREDENTIALS=$(printf '%s' "${AUTH_HEADER#Basic }" | base64 -d 2>/dev/null) || return 1
    AUTH_USER=${CREDENTIALS%%:*}
    [ "$AUTH_USER" = "root" ] || return 1
    [ "$CREDENTIALS" != "$AUTH_USER" ] || return 1
    AUTH_PASSWORD=${CREDENTIALS#*:}
    unset CREDENTIALS

    PASSWD_FILE="/opt/etc/shadow"
    [ -r "$PASSWD_FILE" ] || PASSWD_FILE="/opt/etc/passwd"
    [ -r "$PASSWD_FILE" ] || return 1

    STORED_HASH=$(awk -F: '$1 == "root" { print $2; exit }' "$PASSWD_FILE")
    [ -n "$STORED_HASH" ] || return 1

    case "$STORED_HASH" in
        '!'*|'*'|'' ) return 1 ;;
        '$1$'*)
            AUTH_SALT=$(printf '%s' "$STORED_HASH" | cut -d '$' -f 3)
            AUTH_ALGO="-1"
            ;;
        '$5$'*|'$6$'*)
            case "$STORED_HASH" in
                '$5$'*) AUTH_ALGO="-5"; AUTH_REST=${STORED_HASH#\$5\$} ;;
                '$6$'*) AUTH_ALGO="-6"; AUTH_REST=${STORED_HASH#\$6\$} ;;
            esac
            case "$AUTH_REST" in
                rounds=*)
                    AUTH_ROUNDS=${AUTH_REST%%\$*}
                    AUTH_REST=${AUTH_REST#*\$}
                    AUTH_SALT="${AUTH_ROUNDS}\$${AUTH_REST%%\$*}"
                    ;;
                *) AUTH_SALT=${AUTH_REST%%\$*} ;;
            esac
            ;;
        *) return 1 ;;
    esac

    COMPUTED_HASH=$(printf '%s' "$AUTH_PASSWORD" | openssl passwd "$AUTH_ALGO" -salt "$AUTH_SALT" -stdin 2>/dev/null) || {
        unset AUTH_PASSWORD
        return 1
    }
    unset AUTH_PASSWORD
    [ "$COMPUTED_HASH" = "$STORED_HASH" ]
}

if ! authenticate_entware_root; then
    printf "Status: 401 Unauthorized\r\n"
    printf "WWW-Authenticate: Basic realm=\"SmartDNS WebUI\"\r\n"
    printf "Content-Type: text/plain; charset=utf-8\r\n"
    printf "Cache-Control: no-store\r\n\r\n"
    printf "Требуется логин root и текущий пароль Entware.\n"
    exit 0
fi

if [ -f "$BASE_DIR/api.sh" ]; then
    . "$BASE_DIR/api.sh"
else
    printf "Status: 500 Internal Server Error\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n"
    echo "Ошибка: api.sh не найден"
    exit 1
fi

# API requests are authenticated above, before any action can run.
if [ "${HTTP_X_API:-}" = "1" ] && [ "${REQUEST_METHOD:-}" = "POST" ]; then
    printf "Content-type: text/plain\r\n"
    printf "Cache-Control: no-store, no-cache, must-revalidate, max-age=0\r\n"
    printf "Pragma: no-cache\r\n"
    printf "Expires: 0\r\n\r\n"
    handle_api "${HTTP_X_ACTION:-}" "${HTTP_X_TARGET:-}"
    exit 0
fi

REQUEST_PATH=${REQUEST_URI%%\?*}
case "$REQUEST_PATH" in
    /app.js)
        printf "Content-Type: application/javascript; charset=utf-8\r\nCache-Control: no-store\r\n\r\n"
        cat "$BASE_DIR/app.js"
        ;;
    /parser.js)
        printf "Content-Type: application/javascript; charset=utf-8\r\nCache-Control: no-store\r\n\r\n"
        cat "$BASE_DIR/parser.js"
        ;;
    /template.html)
        printf "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n\r\n"
        cat "$BASE_DIR/template.html"
        ;;
    *)
        printf "Content-Type: text/html; charset=utf-8\r\n"
        printf "Cache-Control: no-store, no-cache, must-revalidate\r\n\r\n"
        if [ -f "$BASE_DIR/template.html" ]; then
            cat "$BASE_DIR/template.html"
        else
            echo "<h3>Ошибка: template.html не найден</h3>"
        fi
        ;;
esac
