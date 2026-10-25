#!/usr/bin/env bash
# Prüft deploy/htaccess mit echtem Apache 2.4 in Docker: Umleitung auf HTTPS, /api → api/index.php,
# SPA-Fallback, Sperren (Punktdateien, api/lib, api/migrationen, api/tests, *.sql, config*),
# Header (Sicherheit, Cache-Control) und MIME-Typen.
#
#   scripts/apache-test.sh            beide PHP-Anbindungen: mod_php (php:8.3-apache) und PHP-FPM
#                                     (httpd:2.4 + php:8.3-fpm, wie Hostpoint)
#   MODES=modphp scripts/apache-test.sh   nur eine Anbindung; KEEP=1 behält das Arbeitsverzeichnis
#
# Der Webroot ist ein Beispiel (Platzhalter-Bundles, Dummy-api/index.php, die Anfrage-Details als JSON
# zurückgibt), keine echte App. Exit-Code 0 = alles grün.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODES="${MODES:-modphp fpm}"
PASS=0
FAIL=0
PREFIX="lernapp-apache-test-$$"

command -v docker >/dev/null || { echo "Docker fehlt."; exit 1; }
command -v openssl >/dev/null || { echo "openssl fehlt."; exit 1; }

# Arbeitsverzeichnis im Repo (tmp/ ist gitignored): Docker teilt nicht jeden Temp-Ordner (z. B. colima)
mkdir -p "$ROOT/tmp"
T="$(mktemp -d "$ROOT/tmp/apache-test.XXXXXX")"
cleanup() {
  docker rm -f "$PREFIX-modphp" "$PREFIX-httpd" "$PREFIX-fpm" >/dev/null 2>&1
  docker network rm "$PREFIX-netz" >/dev/null 2>&1
  if [ -n "${KEEP:-}" ]; then echo "Arbeitsverzeichnis behalten: $T"; else rm -rf "$T"; fi
}
trap cleanup EXIT

ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; }

# ------------------------------------------------------------------ Beispiel-Webroot
W="$T/www"
mkdir -p "$W/api/lib" "$W/api/migrationen" "$W/api/tests" "$W/lektionen" "$W/bilder" "$W/icons" "$W/.git"
cp "$ROOT/deploy/htaccess" "$W/.htaccess"
printf '<!doctype html><html><head><title>Lernapp</title></head><body><app-root></app-root></body></html>\n' > "$W/index.html"
echo 'console.log(1)' > "$W/main-ABCD1234.js"
echo 'console.log(2)' > "$W/chunk-Ca-mr4x-.js"
echo 'console.log(3)' > "$W/ngsw-worker.js"
echo 'console.log(4)' > "$W/worker-basic.min.js"
echo 'export {}' > "$W/modul.mjs"
echo 'body{}' > "$W/styles-WXYZ9876.css"
echo '{"name":"Lernapp"}' > "$W/manifest.webmanifest"
echo '{}' > "$W/ngsw.json"
echo '[]' > "$W/lektionen/index.json"
echo '<svg xmlns="http://www.w3.org/2000/svg"/>' > "$W/bilder/bild.svg"
echo '<svg xmlns="http://www.w3.org/2000/svg"/>' > "$W/icons/icon.svg"
echo '{"geheim":true}' > "$W/.ftp-deploy-sync-state.json"
echo 'geheim' > "$W/.git/config"
echo 'memory_limit = 256M' > "$W/api/.user.ini"
echo '<?php echo "lib";' > "$W/api/lib/db.php"
echo 'CREATE TABLE x (id INT);' > "$W/api/migrationen/001-start.sql"
echo '<?php echo "test";' > "$W/api/tests/laufen.php"
echo '<?php return ["db_password" => "x"];' > "$W/api/config.beispiel.php"
echo '<?php echo "fremd";' > "$W/fremd.php"
echo 'notiz' > "$W/notiz.md"
cat > "$W/api/index.php" <<'PHP'
<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=600');
if (str_starts_with((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/api/ich')) {
    http_response_code(401);
}
echo json_encode([
    'uri' => $_SERVER['REQUEST_URI'] ?? null,
    'query' => $_SERVER['QUERY_STRING'] ?? null,
    'methode' => $_SERVER['REQUEST_METHOD'] ?? null,
    'auth' => $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null,
    'lernapp' => $_SERVER['HTTP_X_LERNAPP'] ?? null,
    'body' => file_get_contents('php://input'),
], JSON_UNESCAPED_SLASHES);
PHP
chmod -R a+rX "$W"

# Selbstsigniertes Zertifikat für den HTTPS-Teil
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=lernapp.test' \
  -keyout "$T/schluessel.pem" -out "$T/zertifikat.pem" >/dev/null 2>&1
chmod a+r "$T/schluessel.pem"

# Apache-Grundeinstellung wie bei einem Shared Hosting: alles erlaubt, die .htaccess muss sperren
VERZEICHNIS='<Directory "/var/www/html">
  Options Indexes FollowSymLinks MultiViews
  AllowOverride All
  Require all granted
</Directory>
<VirtualHost *:443>
  DocumentRoot "/var/www/html"
  SSLEngine on
  SSLCertificateFile /zert/zertifikat.pem
  SSLCertificateKeyFile /zert/schluessel.pem
</VirtualHost>'

frei_port() { # freier Port auf 127.0.0.1
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}

starte_modphp() {
  # mod_php führt PHP ohnehin aus; das Hostpoint-Makro für die PHP-Version nur als No-op nachbilden
  printf '<Macro php-fpm $version>\n  SetEnv LERNAPP_PHP $version\n</Macro>\n%s\n' "$VERZEICHNIS" > "$T/lernapp-modphp.conf"
  docker run -d --name "$PREFIX-modphp" -p "127.0.0.1:$HTTP_PORT:80" -p "127.0.0.1:$HTTPS_PORT:443" \
    -v "$W:/var/www/html:ro" -v "$T:/zert:ro" -v "$T/lernapp-modphp.conf:/etc/apache2/conf-enabled/lernapp.conf:ro" \
    php:8.3-apache bash -c 'a2enmod rewrite headers ssl macro >/dev/null && a2dismod -f alias >/dev/null && apache2-foreground' >/dev/null
}

starte_fpm() {
  docker network create "$PREFIX-netz" >/dev/null
  docker run -d --name "$PREFIX-fpm" --network "$PREFIX-netz" -v "$W:/var/www/html:ro" php:8.3-fpm >/dev/null
  cat > "$T/httpd.conf" <<CONF
ServerRoot "/usr/local/apache2"
Listen 80
Listen 443
ServerName localhost
LoadModule mpm_event_module modules/mod_mpm_event.so
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule authz_host_module modules/mod_authz_host.so
LoadModule mime_module modules/mod_mime.so
LoadModule log_config_module modules/mod_log_config.so
LoadModule headers_module modules/mod_headers.so
LoadModule setenvif_module modules/mod_setenvif.so
LoadModule unixd_module modules/mod_unixd.so
LoadModule dir_module modules/mod_dir.so
LoadModule autoindex_module modules/mod_autoindex.so
LoadModule negotiation_module modules/mod_negotiation.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_fcgi_module modules/mod_proxy_fcgi.so
LoadModule socache_shmcb_module modules/mod_socache_shmcb.so
LoadModule ssl_module modules/mod_ssl.so
LoadModule macro_module modules/mod_macro.so
LoadModule env_module modules/mod_env.so
User daemon
Group daemon
ErrorLog /proc/self/fd/2
LogLevel warn
TypesConfig conf/mime.types
DocumentRoot "/var/www/html"
<Directory />
  AllowOverride None
  Require all denied
</Directory>
# Hostpoint-Makro für die PHP-Version nachgebildet (Use php-fpm php83 in der .htaccess)
<Macro php-fpm \$version>
  SetEnv LERNAPP_PHP \$version
  <FilesMatch "\.php\$">
    SetHandler "proxy:fcgi://$PREFIX-fpm:9000"
  </FilesMatch>
</Macro>
$VERZEICHNIS
CONF
  docker run -d --name "$PREFIX-httpd" --network "$PREFIX-netz" -p "127.0.0.1:$HTTP_PORT:80" -p "127.0.0.1:$HTTPS_PORT:443" \
    -v "$W:/var/www/html:ro" -v "$T:/zert:ro" -v "$T/httpd.conf:/usr/local/apache2/conf/httpd.conf:ro" \
    httpd:2.4 >/dev/null
}

# ------------------------------------------------------------------ Prüfhilfen
H="" ; S=""   # http- und https-Basis
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
erwarte_code() { # erwarte_code <name> <erlaubte codes, z. B. "403|404"> <curl-args…>
  local name="$1" muster="$2" c; shift 2
  c=$(code "$@")
  if [[ "$c" =~ ^($muster)$ ]]; then ok "$name ($c)"; else fail "$name" "erwartet $muster, erhalten $c"; fi
}
kopf() { curl -s -D - -o /dev/null "$@" | tr -d '\r'; }
erwarte_kopf() { # erwarte_kopf <name> <regex über alle Header-Zeilen> <curl-args…>
  local name="$1" muster="$2" k; shift 2
  k=$(kopf "$@")
  if printf '%s\n' "$k" | grep -Eiq "$muster"; then ok "$name"; else fail "$name" "kein Header passt auf /$muster/"; fi
}
erwarte_anzahl() { # erwarte_anzahl <name> <header-name> <anzahl> <curl-args…>
  local name="$1" kopfname="$2" soll="$3" ist; shift 3
  ist=$(kopf "$@" | grep -ic "^$kopfname:")
  if [ "$ist" = "$soll" ]; then ok "$name"; else fail "$name" "$kopfname ${ist}x statt ${soll}x"; fi
}
erwarte_body() { # erwarte_body <name> <regex> <curl-args…>
  local name="$1" muster="$2" b; shift 2
  b=$(curl -s "$@")
  if printf '%s' "$b" | grep -Eq "$muster"; then ok "$name"; else fail "$name" "Antwort: ${b:0:200}"; fi
}

pruefe() {
  echo "-- Umleitung und Auslieferung"
  erwarte_code "HTTP mit fremdem Host → 301" "301" -H 'Host: lernapp.urinet.ch' "$H/lektion/x?a=1"
  erwarte_kopf "Ziel der Umleitung behält Pfad und Query" '^location: https://lernapp\.urinet\.ch/lektion/x\?a=1$' -H 'Host: lernapp.urinet.ch' "$H/lektion/x?a=1"
  erwarte_code "ACME-Challenge bleibt auf HTTP" "404" -H 'Host: lernapp.urinet.ch' "$H/.well-known/acme-challenge/abc"
  erwarte_code "HTTPS: Startseite" "200" -k "$S/"
  erwarte_body "HTTPS: Startseite ist index.html" '<app-root>' -k "$S/"
  erwarte_code "HTTPS: keine Umleitungsschleife" "200" -k -H 'Host: lernapp.urinet.ch' "$S/lektion/x"
  erwarte_kopf "HTTPS: HSTS" '^strict-transport-security: max-age=31536000' -k "$S/"
  erwarte_code "SPA-Route → index.html" "200" "$H/lektion/informatik/lernen"
  erwarte_body "SPA-Route liefert index.html" '<app-root>' "$H/lektion/informatik/lernen"
  erwarte_code "Fehlende Datei mit Endung → 404" "404" "$H/gibts-nicht.js"
  erwarte_code "Fehlendes Bild → 404" "404" "$H/bilder/gibts-nicht.svg"
  erwarte_code "Verzeichnisliste gesperrt" "403" "$H/bilder/"
  erwarte_code "Keine MultiViews (/manifest → nicht manifest.webmanifest)" "200" "$H/manifest"
  erwarte_body "… sondern index.html" '<app-root>' "$H/manifest"
  erwarte_kopf "HTTP: kein HSTS" '^x-frame-options: DENY' "$H/"
  if kopf "$H/" | grep -qi '^strict-transport-security'; then fail "HSTS nur über HTTPS"; else ok "HSTS nur über HTTPS"; fi

  echo "-- API"
  erwarte_code "/api/status → index.php" "200" "$H/api/status?cb=1"
  erwarte_body "REQUEST_URI und Query bleiben erhalten" '"uri":"/api/status\?cb=1","query":"cb=1"' "$H/api/status?cb=1"
  erwarte_kopf "/api ohne Schrägstrich → /api/ (DirectorySlash)" '^location: http://localhost:[0-9]+/api/$' "$H/api"
  erwarte_body "/api/ → index.php" '"uri":"/api/"' "$H/api/"
  erwarte_code "/api/ich → 401 von PHP durchgereicht" "401" "$H/api/ich"
  erwarte_body "Authorization (Bearer) kommt in PHP an" '"auth":"Bearer abc123"' -X POST -H 'Authorization: Bearer abc123' "$H/api/admin/migrieren"
  erwarte_body "POST mit Body und X-Lernapp" '"methode":"DELETE".*"lernapp":"1"' -X DELETE -H 'X-Lernapp: 1' "$H/api/daten"
  erwarte_body "POST-Body kommt an" '"body":"\{\\"a\\":1\}"' -X POST -H 'Content-Type: application/json' -d '{"a":1}' "$H/api/sync"
  erwarte_body "/api/index.php direkt" '"uri":"/api/index.php"' "$H/api/index.php"
  erwarte_kopf "API: Cache-Control no-store" '^cache-control: no-store$' "$H/api/status"
  erwarte_anzahl "API: Cache-Control nur einmal" "cache-control" 1 "$H/api/status"
  erwarte_anzahl "API: nosniff nur einmal" "x-content-type-options" 1 "$H/api/status"
  erwarte_kopf "API: JSON" '^content-type: application/json' "$H/api/status"

  echo "-- Sperren"
  erwarte_code "api/lib gesperrt" "403|404" "$H/api/lib/db.php"
  erwarte_code "api/lib/ (Ordner) gesperrt" "403|404" "$H/api/lib/"
  erwarte_code "api/migrationen gesperrt" "403|404" "$H/api/migrationen/001-start.sql"
  erwarte_code "api/tests gesperrt" "403|404" "$H/api/tests/laufen.php"
  erwarte_code "api/.user.ini gesperrt" "403|404" "$H/api/.user.ini"
  erwarte_code ".ftp-deploy-sync-state.json gesperrt" "403|404" "$H/.ftp-deploy-sync-state.json"
  erwarte_code ".htaccess gesperrt" "403|404" "$H/.htaccess"
  erwarte_code ".git/config gesperrt" "403|404" "$H/.git/config"
  erwarte_code "*.md gesperrt" "403|404" "$H/notiz.md"
  erwarte_code "Andere PHP-Datei nicht ausführbar" "403|404" "$H/fremd.php"
  erwarte_code "Fehlende PHP-Datei" "403|404" "$H/gibts-nicht.php"
  # Umgehungsversuche: Kodierung, Gross-/Kleinschreibung, Punkt-Segmente, PATH_INFO
  erwarte_code "api/lib kodiert (%6c)" "403|404" "$H/api/%6cib/db.php"
  erwarte_code "api/lib mit %2F" "403|404" "$H/api/lib%2Fdb.php"
  erwarte_code "api/lib über ./" "403|404" --path-as-is "$H/api/./lib/db.php"
  erwarte_code "api/lib über //" "403|404" --path-as-is "$H/api//lib/db.php"
  erwarte_code "api/lib über index.php/../" "403|404" --path-as-is "$H/api/index.php/../lib/db.php"
  erwarte_code "API/lib (gross)" "403|404" "$H/API/lib/db.php"
  erwarte_code "api/lib mit PATH_INFO" "403|404" "$H/api/lib/db.php/x"
  erwarte_code "api/migrationen kodiert" "403|404" "$H/api/migrationen/001-start%2Esql"
  erwarte_code "config-Vorlage gesperrt" "403|404" "$H/api/config.beispiel.php"
  erwarte_code "Andere PHP-Datei mit PATH_INFO" "403|404" "$H/fremd.php/x"
  erwarte_code "Andere PHP-Datei gross geschrieben" "403|404" "$H/fremd.PHP"
  erwarte_code "Andere PHP-Datei mit Query" "403|404" "$H/fremd.php?a=1"
  if curl -s "$H/fremd.php/x" | grep -q 'fremd'; then fail "PHP ausserhalb api/index.php nie ausgeführt"; else ok "PHP ausserhalb api/index.php nie ausgeführt"; fi

  echo "-- Header und Caching"
  erwarte_kopf "nosniff" '^x-content-type-options: nosniff$' "$H/"
  erwarte_kopf "Referrer-Policy" '^referrer-policy: no-referrer$' "$H/"
  erwarte_kopf "X-Frame-Options" '^x-frame-options: DENY$' "$H/"
  erwarte_kopf "CSP frame-ancestors" "^content-security-policy: frame-ancestors 'none'$" "$H/"
  erwarte_kopf "Permissions-Policy" '^permissions-policy: camera=\(self\)' "$H/"
  erwarte_kopf "Startseite no-cache" '^cache-control: no-cache$' "$H/"
  erwarte_kopf "SPA-Route no-cache" '^cache-control: no-cache$' "$H/lektion/x"
  erwarte_kopf "ngsw-worker.js no-cache" '^cache-control: no-cache$' "$H/ngsw-worker.js"
  erwarte_kopf "worker-basic.min.js no-cache" '^cache-control: no-cache$' "$H/worker-basic.min.js"
  erwarte_kopf "Lektionen no-cache" '^cache-control: no-cache$' "$H/lektionen/index.json"
  erwarte_kopf "main-<hash>.js immutable" '^cache-control: public, max-age=31536000, immutable$' "$H/main-ABCD1234.js"
  erwarte_kopf "chunk-<hash mit - und _>.js immutable" '^cache-control: public, max-age=31536000, immutable$' "$H/chunk-Ca-mr4x-.js"
  erwarte_kopf "styles-<hash>.css immutable" '^cache-control: public, max-age=31536000, immutable$' "$H/styles-WXYZ9876.css"
  erwarte_kopf "Bilder 1 Tag" '^cache-control: public, max-age=86400$' "$H/bilder/bild.svg"
  erwarte_kopf "Icons 1 Tag" '^cache-control: public, max-age=86400$' "$H/icons/icon.svg"
  erwarte_anzahl "Statische Datei: Cache-Control nur einmal" "cache-control" 1 "$H/main-ABCD1234.js"
  erwarte_kopf "MIME webmanifest" '^content-type: application/manifest\+json' "$H/manifest.webmanifest"
  erwarte_kopf "MIME mjs" '^content-type: text/javascript' "$H/modul.mjs"
  erwarte_kopf "MIME json" '^content-type: application/json' "$H/ngsw.json"
}

for MODE in $MODES; do
  echo "== $MODE"
  HTTP_PORT=$(frei_port); HTTPS_PORT=$(frei_port)
  H="http://localhost:$HTTP_PORT"; S="https://localhost:$HTTPS_PORT"
  case "$MODE" in
    modphp) starte_modphp; C="$PREFIX-modphp" ;;
    fpm) starte_fpm; C="$PREFIX-httpd" ;;
    *) echo "Unbekannter Modus $MODE (modphp | fpm)"; exit 1 ;;
  esac
  bereit=""
  for _ in $(seq 1 60); do
    if [ "$(code "$H/api/status")" = 200 ]; then bereit=1; break; fi
    sleep 0.5
  done
  if [ -z "$bereit" ]; then
    fail "$MODE: Apache bereit" "$(docker logs --tail 20 "$C" 2>&1)"
  else
    pruefe
  fi
  [ "$FAIL" = 0 ] || docker logs --tail 20 "$C" 2>&1 | sed 's/^/       log: /'
  docker rm -f "$PREFIX-modphp" "$PREFIX-httpd" "$PREFIX-fpm" >/dev/null 2>&1
  docker network rm "$PREFIX-netz" >/dev/null 2>&1
done

echo
echo "Apache-Test: $PASS ok, $FAIL fehlgeschlagen"
[ "$FAIL" = 0 ]
