#!/bin/sh
# Configure HTTP Basic Auth for SmartDNS WebUI.
# This sets a panel-specific password for username "root"; it does not read
# or change the Unix/Entware root password.

set -eu

AUTH_DIR="/opt/etc/lighttpd"
AUTH_FILE="$AUTH_DIR/smartdns-webui.htpasswd"
LIGHTTPD_CONF="/opt/etc/lighttpd/lighttpd.conf"
LIGHTTPD_INIT="/opt/etc/init.d/S80lighttpd"
LIGHTTPD_BIN="/opt/sbin/lighttpd"
TMP_FILE="$AUTH_FILE.tmp.$$"
BACKUP_FILE="$AUTH_FILE.bak.$$"

cleanup() {
    rm -f "$TMP_FILE" "$BACKUP_FILE"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

[ "$(id -u)" = "0" ] || fail "запустите скрипт от root Entware"
[ -x "$LIGHTTPD_INIT" ] || fail "не найден $LIGHTTPD_INIT"
command -v openssl >/dev/null 2>&1 || fail "не найден openssl; установите пакет openssl-util Entware"
[ -d "$AUTH_DIR" ] || fail "не найден каталог $AUTH_DIR"

echo "Настройка отдельного пароля панели SmartDNS WebUI."
echo "Имя пользователя: root"
echo "Это НЕ пароль SSH/root; будет задан отдельный пароль веб-панели."

while :; do
    printf "Новый пароль панели (минимум 12 символов): "
    stty -echo
    IFS= read -r PASS1 || { stty echo; echo; fail "не удалось прочитать пароль"; }
    stty echo
    echo
    printf "Повторите пароль: "
    stty -echo
    IFS= read -r PASS2 || { stty echo; echo; fail "не удалось прочитать пароль"; }
    stty echo
    echo
    [ "$PASS1" = "$PASS2" ] || { echo "Пароли не совпадают."; continue; }
    [ "${#PASS1}" -ge 12 ] || { echo "Пароль должен содержать минимум 12 символов."; continue; }
    break
done

HASH=$(printf '%s' "$PASS1" | openssl passwd -apr1 -stdin) || fail "openssl не смог создать хеш"
unset PASS1 PASS2
case "$HASH" in
    \$apr1\$*) ;;
    *) fail "openssl вернул неожиданный формат хеша" ;;
esac

# Lighttpd must be able to read the hash file, but it must not be world-readable.
# Use the configured lighttpd group when present; otherwise keep root:root.
LIGHTTPD_GROUP=$(grep -h '^[[:space:]]*server\.groupname[[:space:]]*=' "$LIGHTTPD_CONF" "$AUTH_DIR"/conf.d/*.conf 2>/dev/null |
    sed -n 's/.*=[[:space:]]*"\([^"]*\)".*/\1/p' | tail -n 1)
LIGHTTPD_USER=$(grep -h '^[[:space:]]*server\.username[[:space:]]*=' "$LIGHTTPD_CONF" "$AUTH_DIR"/conf.d/*.conf 2>/dev/null |
    sed -n 's/.*=[[:space:]]*"\([^"]*\)".*/\1/p' | tail -n 1)
if [ -z "$LIGHTTPD_GROUP" ] && [ -n "$LIGHTTPD_USER" ]; then
    LIGHTTPD_GROUP=$(id -gn "$LIGHTTPD_USER" 2>/dev/null || true)
fi
[ -n "$LIGHTTPD_GROUP" ] || LIGHTTPD_GROUP="root"

printf 'root:%s\n' "$HASH" > "$TMP_FILE" || fail "не удалось записать временный файл"
chmod 640 "$TMP_FILE" || fail "не удалось выставить права"
chown "root:$LIGHTTPD_GROUP" "$TMP_FILE" 2>/dev/null || {
    # Do not fall back to a world-readable hash file.
    fail "не удалось назначить группу $LIGHTTPD_GROUP; проверьте server.groupname в конфигурации lighttpd"
}

if [ -f "$AUTH_FILE" ]; then
    cp -p "$AUTH_FILE" "$BACKUP_FILE" || fail "не удалось сохранить старый файл авторизации"
fi
mv -f "$TMP_FILE" "$AUTH_FILE" || fail "не удалось установить файл авторизации"

if [ -x "$LIGHTTPD_BIN" ] && [ -f "$LIGHTTPD_CONF" ]; then
    if ! "$LIGHTTPD_BIN" -tt -f "$LIGHTTPD_CONF"; then
        [ ! -f "$BACKUP_FILE" ] || cp -p "$BACKUP_FILE" "$AUTH_FILE"
        [ -f "$BACKUP_FILE" ] || rm -f "$AUTH_FILE"
        fail "проверка конфигурации lighttpd не пройдена; предыдущий файл восстановлен"
    fi
fi

if ! "$LIGHTTPD_INIT" restart; then
    [ ! -f "$BACKUP_FILE" ] || cp -p "$BACKUP_FILE" "$AUTH_FILE"
    [ -f "$BACKUP_FILE" ] || rm -f "$AUTH_FILE"
    "$LIGHTTPD_INIT" restart || true
    fail "lighttpd не перезапустился; предыдущий файл авторизации восстановлен"
fi

echo "Авторизация настроена. Логин: root"
echo "Файл хеша: $AUTH_FILE (права 640; пароль хранится только в виде хеша)."
echo "Открывайте панель только в LAN/VPN; HTTP Basic Auth без HTTPS не защищает пароль от прослушивания в незащищённой сети."
