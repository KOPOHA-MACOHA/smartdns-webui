#!/bin/sh

echo "========================================"
echo "  Установка SmartDNS WebUI для Entware  "
echo "========================================"

WEB_DIR="/opt/share/www/smartdns"
CONF_DIR="/opt/etc/lighttpd/conf.d"

# Укажи здесь свой логин GitHub и название репозитория
REPO_URL="https://raw.githubusercontent.com/KOPOHA-MACOHA/smartdns-webui/main"

echo "[1/4] Создание директорий..."
mkdir -p "$WEB_DIR"
mkdir -p "$CONF_DIR"

echo "[2/4] Скачивание файлов..."
# Генерируем уникальный timestamp для обхода кэша GitHub
T=$(date +%s)

curl -sL "$REPO_URL/index.cgi?t=$T" -o "$WEB_DIR/index.cgi"
curl -sL "$REPO_URL/api.sh?t=$T" -o "$WEB_DIR/api.sh"
curl -sL "$REPO_URL/template.html?t=$T" -o "$WEB_DIR/template.html"
curl -sL "$REPO_URL/parser.js?t=$T" -o "$WEB_DIR/parser.js"
curl -sL "$REPO_URL/app.js?t=$T" -o "$WEB_DIR/app.js"
curl -sL "$REPO_URL/version.txt?t=$T" -o "$WEB_DIR/version.txt"

echo "[3/4] Настройка прав и веб-сервера..."
# Очищаем от возможных Windows-переносов строк и даем права
sed -i 's/\r$//' "$WEB_DIR/index.cgi" "$WEB_DIR/api.sh"
chmod +x "$WEB_DIR/index.cgi"
chmod +x "$WEB_DIR/api.sh"

# Создаем конфиг маршрутизации для lighttpd
cat << 'EOF' > "$CONF_DIR/90-smartdns.conf"
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

echo "[4/4] Перезапуск веб-сервера..."
# Убиваем зависшие процессы на всякий случай
killall -9 lighttpd 2>/dev/null
/opt/etc/init.d/S80lighttpd start

echo "========================================"
echo "Установка завершена!"
echo "Интерфейс доступен по адресу: http://<IP_РОУТЕРА>:3000"
echo "========================================"