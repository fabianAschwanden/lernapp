#!/usr/bin/env bash
# Startet (oder benutzt) eine MariaDB 10.11 im Docker-Container «lernapp-test-db» auf Port 3307
# für die PHP-Tests (php api/tests/laufen.php) und die E2E-Tests.
#
#   scripts/test-db.sh          Container starten bzw. wiederverwenden, warten bis bereit
#   scripts/test-db.sh stop     Container stoppen und entfernen
#
# Zugang (nur lokal, keine Geheimnisse): Datenbank lernapp_test, Benutzer lernapp, Passwort lernapp.
# Die Tests lesen LERNAPP_TEST_DB_DSN / LERNAPP_TEST_DB_USER / LERNAPP_TEST_DB_PASSWORD;
# ohne diese Variablen gelten genau diese Werte.
set -euo pipefail

NAME=lernapp-test-db
PORT="${LERNAPP_TEST_DB_PORT:-3307}"

if [ "${1:-}" = "stop" ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  echo "Container $NAME entfernt."
  exit 0
fi

if [ -z "$(docker ps -q -f "name=^${NAME}$")" ]; then
  if [ -n "$(docker ps -aq -f "name=^${NAME}$")" ]; then
    docker start "$NAME" >/dev/null
  else
    docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:3306" \
      -e MARIADB_ROOT_PASSWORD=root \
      -e MARIADB_DATABASE=lernapp_test \
      -e MARIADB_USER=lernapp \
      -e MARIADB_PASSWORD=lernapp \
      mariadb:10.11 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci >/dev/null
  fi
fi

for _ in $(seq 1 60); do
  if docker exec "$NAME" mariadb -h127.0.0.1 -ulernapp -plernapp -e 'SELECT 1' lernapp_test >/dev/null 2>&1; then
    echo "MariaDB bereit: 127.0.0.1:${PORT}, Datenbank lernapp_test (Benutzer lernapp)."
    exit 0
  fi
  sleep 1
done
echo "MariaDB im Container $NAME ist nach 60 s nicht bereit." >&2
docker logs --tail 30 "$NAME" >&2 || true
exit 1
