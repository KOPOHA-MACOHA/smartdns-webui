#!/bin/sh
export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"

BASE_DIR=$(dirname "$(readlink -f "$0")")

if [ -f "$BASE_DIR/api.sh" ]; then
    . "$BASE_DIR/api.sh"
else
    printf "Content-type: text/html\r\n\r\n"
    echo "<h3>Ошибка: api.sh не найден в $BASE_DIR</h3>"
    exit 1
fi

# API запросы теперь ТОЛЬКО через POST для полной защиты от кэширования браузером
if [ "$HTTP_X_API" = "1" ] && [ "$REQUEST_METHOD" = "POST" ]; then
    printf "Content-type: text/plain\r\n"
    printf "Cache-Control: no-store, no-cache, must-revalidate, max-age=0\r\n"
    printf "Pragma: no-cache\r\n"
    printf "Expires: 0\r\n\r\n"
    
    handle_api "$HTTP_X_ACTION" "$HTTP_X_TARGET"
    exit 0
fi

# Отдача HTML-морды (тоже с запретом кэширования)
printf "Content-type: text/html\r\n"
printf "Cache-Control: no-store, no-cache, must-revalidate\r\n\r\n"
if [ -f "$BASE_DIR/template.html" ]; then
    cat "$BASE_DIR/template.html"
else
    echo "<h3>Ошибка: template.html не найден</h3>"
fi