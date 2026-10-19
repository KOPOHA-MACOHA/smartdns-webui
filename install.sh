#!/bin/sh
set -eu

WEB_DIR="/opt/share/www/smartdns"
CONF_DIR="/opt/etc/lighttpd/conf.d"
LIGHTTPD_INIT="/opt/etc/init.d/S80lighttpd"
LIGHTTPD_CONF="/opt/etc/lighttpd/lighttpd.conf"
REPO_URL="https://raw.githubusercontent.com/KOPOHA-MACOHA/smartdns-webui/main"
FILES="index.cgi api.sh template.html parser.js app.js version.txt setup-auth.sh"
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
server.modules += ( "mod_cgi", "mod_rewrite", "mod_auth" )

$SERVER["socket"] == ":3000" {
    server.document-root = "/opt/share/www/smartdns/"
    index-file.names = ( "index.cgi" )
    cgi.assign = ( ".cgi" => "/bin/sh" )

    # Fail closed: until setup-auth.sh creates the credentials file, access is denied.
    auth.backend = "htpasswd"
    auth.backend.htpasswd.userfile = "/opt/etc/lighttpd/smartdns-webui.htpasswd"
    auth.require = ( "" => (
        "method" => "basic",
        "realm" => "SmartDNS WebUI",
        "require" => "user=root"
    ) )

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
chmod 755 "$STAGE_DIR/index.cgi" "$STAGE_DIR/api.sh" "$STAGE_DIR/setup-auth.sh" ||
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
if [ -x "$LIGHTTPD_BIN" ] && [ -f "$LIGHTTPD_CONF" ]; then
    if ! "$LIGHTTPD_BIN" -tt -f "$LIGHTTPD_CONF"; then
        restore_backup
        fail "проверка конфигурации lighttpd не пройдена; файлы восстановлены"
    fi
else
    echo "WARNING: lighttpd или основной конфиг не найден; синтаксическая проверка пропущена" >&2
fi

if ! "$LIGHTTPD_INIT" restart; then
    restore_backup
    "$LIGHTTPD_INIT" restart || true
    fail "lighttpd не перезапустился; выполнен откат файлов"
fi

echo "========================================"
echo "Установка/обновление завершено."
echo "Резервная копия: $BACKUP_DIR"
echo "Интерфейс: http://<IP_РОУТЕРА>:3000"
echo "Если авторизация ещё не настроена, подключитесь по SSH и выполните: sh $WEB_DIR/setup-auth.sh"
echo "========================================"
