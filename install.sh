#!/bin/sh
set -eu

WEB_DIR="/opt/share/www/smartdns"
CONF_DIR="/opt/etc/lighttpd/conf.d"
LIGHTTPD_INIT="/opt/etc/init.d/S80lighttpd"
LIGHTTPD_CONF="/opt/etc/lighttpd/lighttpd.conf"
REPO_REF="${REPO_REF:-main}"
case "$REPO_REF" in
    *[!A-Za-z0-9._/-]*|""|/*|*..*) echo "ERROR: некорректный REPO_REF" >&2; exit 1 ;;
esac
REPO_URL="https://raw.githubusercontent.com/KOPOHA-MACOHA/smartdns-webui/$REPO_REF"
FILES="index.cgi api.sh template.html parser.js validator.js app.js version.txt"
T="$(date +%Y%m%d-%H%M%S)-$$"
BACKUP_ROOT="/opt/var/backups/smartdns-webui"
BACKUP_DIR="$BACKUP_ROOT/$T"
STAGE_DIR="/opt/tmp/smartdns-webui-install-$$"
CONF_NAME="90-smartdns.conf"
CHANGED=0

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

restore_backup() {
    echo "Восстановление предыдущих файлов..."
    for name in $FILES; do
        if [ -f "$BACKUP_DIR/$name" ]; then
            cp -p "$BACKUP_DIR/$name" "$WEB_DIR/$name" || echo "WARNING: не удалось восстановить $WEB_DIR/$name" >&2
        else
            rm -f "$WEB_DIR/$name"
        fi
    done
    if [ -f "$BACKUP_DIR/$CONF_NAME" ]; then
        cp -p "$BACKUP_DIR/$CONF_NAME" "$CONF_DIR/$CONF_NAME" || echo "WARNING: не удалось восстановить конфиг lighttpd" >&2
    else
        rm -f "$CONF_DIR/$CONF_NAME"
    fi
}

lighttpd_healthy() {
    # pidof alone is insufficient: confirm the local HTTP listener responds.
    [ -n "$(pidof lighttpd 2>/dev/null)" ] || return 1
    code="$(curl -sS --connect-timeout 3 --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null)" || return 1
    case "$code" in
        [1-5][0-9][0-9]) return 0 ;;
        *) return 1 ;;
    esac
}

cleanup() {
    rm -rf "$STAGE_DIR"
}

on_exit() {
    status=$?
    if [ "$status" -ne 0 ] && [ "$CHANGED" -eq 1 ]; then
        restore_backup
    fi
    cleanup
    exit "$status"
}
trap on_exit EXIT
trap 'exit 1' HUP INT TERM

echo "========================================"
echo "  SmartDNS WebUI для Entware"
echo "========================================"

command -v curl >/dev/null 2>&1 || fail "curl не найден"
command -v sh >/dev/null 2>&1 || fail "sh не найден"
[ -x "$LIGHTTPD_INIT" ] || fail "не найден исполняемый $LIGHTTPD_INIT"

mkdir -p "$WEB_DIR" "$CONF_DIR" "$BACKUP_ROOT" "$STAGE_DIR" "$BACKUP_DIR" ||
    fail "не удалось создать рабочие каталоги"

echo "[1/5] Скачивание файлов во временный каталог..."
for name in $FILES; do
    if ! curl -fsSL --connect-timeout 15 --max-time 120 "$REPO_URL/$name" -o "$STAGE_DIR/$name"; then
        fail "не удалось скачать $name; установленная версия не изменена"
    fi
    [ -s "$STAGE_DIR/$name" ] || fail "скачанный файл пуст: $name"
done

echo "[2/5] Проверка скачанных файлов..."
sed -i 's/\r$//' "$STAGE_DIR/index.cgi" "$STAGE_DIR/api.sh"
sh -n "$STAGE_DIR/index.cgi" || fail "синтаксическая ошибка в index.cgi"
sh -n "$STAGE_DIR/api.sh" || fail "синтаксическая ошибка в api.sh"
case "$(cat "$STAGE_DIR/version.txt" | tr -d '\r\n')" in
    ""|*[!0-9.]* ) fail "некорректный version.txt" ;;
esac

cat > "$STAGE_DIR/$CONF_NAME" <<'EOF'
server.modules += ( "mod_cgi", "mod_rewrite" )

$SERVER["socket"] == ":3000" {
    server.document-root = "/opt/share/www/smartdns/"
    index-file.names = ( "index.cgi" )
    cgi.assign = ( ".cgi" => "/bin/sh" )

    url.rewrite-once = (
        "^/(settings|lists|logs)$" => "/index.cgi"
    )
}
EOF

echo "[3/5] Создание резервной копии..."
for name in $FILES; do
    [ ! -f "$WEB_DIR/$name" ] || cp -p "$WEB_DIR/$name" "$BACKUP_DIR/$name" ||
        fail "не удалось сохранить резервную копию $name"
done
[ ! -f "$CONF_DIR/$CONF_NAME" ] ||
    cp -p "$CONF_DIR/$CONF_NAME" "$BACKUP_DIR/$CONF_NAME" ||
    fail "не удалось сохранить резервную копию конфига lighttpd"

echo "[4/5] Установка проверенных файлов..."
for name in $FILES; do
    chmod 644 "$STAGE_DIR/$name" || fail "chmod не удался для $name"
done
chmod 755 "$STAGE_DIR/index.cgi" "$STAGE_DIR/api.sh" ||
    fail "не удалось установить права CGI-файлов"
chmod 644 "$STAGE_DIR/$CONF_NAME" || fail "не удалось установить права конфига"

CHANGED=1
for name in $FILES; do
    cp "$STAGE_DIR/$name" "$WEB_DIR/.$name.new.$$" ||
        fail "не удалось подготовить $name"
    mv -f "$WEB_DIR/.$name.new.$$" "$WEB_DIR/$name" ||
        fail "не удалось заменить $name"
done
cp "$STAGE_DIR/$CONF_NAME" "$CONF_DIR/.$CONF_NAME.new.$$" ||
    fail "не удалось подготовить конфиг lighttpd"
mv -f "$CONF_DIR/.$CONF_NAME.new.$$" "$CONF_DIR/$CONF_NAME" ||
    fail "не удалось установить конфиг lighttpd"

echo "[5/5] Проверка конфигурации и перезапуск lighttpd..."
LIGHTTPD_BIN="/opt/sbin/lighttpd"
[ -x "$LIGHTTPD_BIN" ] || fail "не найден исполняемый $LIGHTTPD_BIN; установка отменена"
[ -f "$LIGHTTPD_CONF" ] || fail "не найден основной конфиг $LIGHTTPD_CONF; установка отменена"
if ! "$LIGHTTPD_BIN" -tt -f "$LIGHTTPD_CONF"; then
    restore_backup
    CHANGED=0
    fail "проверка конфигурации lighttpd не пройдена; файлы восстановлены"
fi

RESTART_RC=0
"$LIGHTTPD_INIT" restart || RESTART_RC=$?
if [ "$RESTART_RC" -ne 0 ]; then
    # Entware's rc.func can return failure even when the daemon has come up.
    # Do not roll back a live, responding service solely because of that code.
    if lighttpd_healthy; then
        echo "WARNING: restart вернул код $RESTART_RC, но lighttpd отвечает по HTTP; откат не выполняется."
    else
        restore_backup
        CHANGED=0
        # Recover only if the daemon is absent; never blindly restart a live process.
        if [ -z "$(pidof lighttpd 2>/dev/null)" ]; then
            "$LIGHTTPD_INIT" start || echo "WARNING: не удалось запустить lighttpd после отката" >&2
        fi
        fail "после перезапуска lighttpd не отвечает; файлы восстановлены, служба требует проверки"
    fi
fi

# Remove artifacts from the earlier panel-specific-password implementation.
# They are no longer referenced; authentication now uses Entware root credentials.
rm -f "$WEB_DIR/setup-auth.sh" /opt/etc/lighttpd/smartdns-webui.htpasswd

echo "========================================"
echo "Установка/обновление завершено."
echo "Резервная копия: $BACKUP_DIR"
echo "Интерфейс: http://<IP_РОУТЕРА>:3000"
echo "Авторизация использует логин root и текущий пароль Entware; отдельный пароль панели не создаётся."
echo "========================================"
