# Lernapp-API (PHP)

Kleine API unter `/api` auf derselben Domain wie die App (Hostpoint: Apache mit PHP ≥ 8.3, kein
Composer). Einstieg `index.php`, Bausteine in `lib/` (`router.php` = Endpunkte), Schema in
`migrationen/NNN-*.sql` (`{{praefix}}` = `tabellen_praefix`), Vorlage der Konfiguration
`config.beispiel.php`.

## Lokal

```bash
scripts/test-db.sh                                   # MariaDB 10.11 (Docker, Port 3307)
cp api/config.beispiel.php api/config.lokal.php      # ausfüllen, testmodus => true (gitignored)
npx ng build
LERNAPP_CONFIG=api/config.lokal.php php -d post_max_size=16M -S localhost:8080 scripts/php-router.php
curl -X POST -H 'Authorization: Bearer <deploy_token>' localhost:8080/api/admin/migrieren
```

`npm start` leitet `/api` per Proxy an Port 8080 weiter.

## Tests

```bash
scripts/test-db.sh && php api/tests/laufen.php       # optional Filter: php api/tests/laufen.php sync
```

Die Tests rufen die API direkt auf (ohne Webserver), dazu `http-test.php` über `php -S` mit
`scripts/php-router.php` und `google-mock.php` als gemockter Google-Token-Endpunkt.
DB-Zugang per `LERNAPP_TEST_DB_DSN`, `LERNAPP_TEST_DB_USER`, `LERNAPP_TEST_DB_PASSWORD`
(Standard: Container aus `scripts/test-db.sh`), Tabellenpräfix `phptest_`.

## Migrationen

Der Deploy lädt zuerst den Code hoch (FTP) und ruft erst danach `POST /api/admin/migrieren` auf. Die
Datenbank ist nur aus Hostpoint-Webprozessen erreichbar, die Reihenfolge lässt sich also nicht
umdrehen. Schlägt die Migration fehl, läuft der neue Code weiter gegen das alte Schema. Deshalb gilt
expand/contract:

- Migrationen sind additiv: neue Tabellen, neue Spalten mit DEFAULT oder NULL erlaubt, neue Indizes.
- Der Code der Version N muss mit Schema N−1 laufen. Neue Spalten liest er tolerant (Fallback bei
  fehlender Spalte oder Tabelle) oder nutzt sie erst im nächsten Deploy.
- Umbenennen = neue Spalte anlegen, in beide schreiben, die alte erst in einem späteren Deploy
  entfernen (DROP/RENAME/NOT NULL ohne DEFAULT nie im selben Deploy wie der Code, der sie braucht).
- Bestehende `migrationen/NNN-*.sql` nie ändern, jede Änderung bekommt eine neue Nummer.

Ausnahme bisher: 002 (Login-Zustand im Cookie) und 003 (`sync_epoche`) kamen vor dem ersten
produktiven Deploy dazu — der Code setzt `sync_epoche` voraus.

**Nach einer Wiederherstellung der DB aus einem Backup** einmal
`UPDATE <praefix>benutzer SET sync_epoche = SUBSTRING(MD5(RAND()), 1, 16)` ausführen: Dann gleichen alle
Geräte vollständig ab (siehe `GET /api/sync` unten).

## Verträge in Kürze

- Fehler: `{"fehler": "<code>", "meldung": "<Text>"}`; alle Antworten `Cache-Control: no-store`.
- Ändernde Anfragen (POST/PUT/DELETE) brauchen `X-Lernapp: 1` und mit Körper
  `Content-Type: application/json`, sonst 403 `csrf`. Ausnahme: `POST /api/admin/migrieren`
  (Bearer-Token, kein Cookie).
- Sitzung: Cookie `__Host-lernapp_sitzung` (Secure, Path=/, ohne Domain — keine andere Subdomain
  von urinet.ch kann es setzen; im Testmodus über http ohne Präfix: `lernapp_sitzung`), HttpOnly,
  SameSite=Lax, 90 Tage gleitend, höchstens 365 Tage ab der Anmeldung. Die Allowlist
  `erlaubte_emails` gilt bei jeder Anfrage; wer nicht (mehr) drauf ist, bekommt 401
  `nicht-freigegeben` und alle Sitzungen werden geschlossen.
- Google-Login: Der Zustand (state, PKCE-Verifier, nonce, Rücksprungziel ≤ 512 Zeichen, 10 min)
  liegt nur im HMAC-signierten Cookie `__Host-lernapp_login` (Testmodus: `lernapp_login`), nicht in
  der DB — ohne Anmeldung schreibt niemand in die Datenbank.
- `GET /api/ich` und `POST /api/test/anmelden` → `{email, name, konto}`. `konto` ist eine stabile
  Kennung (Hash der Google-ID). Schickt das Gerät `X-Lernapp-Konto: <konto>` mit und gehört die
  Sitzung einem anderen Konto, antworten `/api/sync` und `DELETE /api/daten` mit 409 `anderes-konto`.
- `POST /api/auth/abmelden-ueberall` beendet alle Sitzungen der Person (204, CSRF wie oben).
- `GET /api/sync?seit=&limit=` → `{version, epoche, datensaetze, mehr}`. Bei `mehr: true` ist
  `version` die Version des letzten gelieferten Datensatzes: als nächstes `seit` verwenden, bis
  `mehr` false ist. Jeder Datensatz trägt zusätzlich seine `version`. Höchstens 500 Datensätze bzw.
  ~2 MB `daten` pro Antwort (mindestens ein Datensatz). `epoche` wechselt nur, wenn die DB
  zurückgesetzt wurde; ist `seit` grösser als die Server-Version, kommt
  `{version, epoche, datensaetze: [], mehr: false, zurueckgesetzt: true}` — in beiden Fällen gleicht
  das Gerät vollständig neu ab.
- `POST /api/sync` → `{version, epoche, angenommen, abgelehnt: [{art, schluessel, grund, datensatz?}],
  korrigiert?: [{art, schluessel, geaendertAm}]}`. `grund`: `veraltet` (Serverstand ist neuer oder
  gleich alt; `datensatz` liefert ihn im Format von GET mit, solange zusammen ≤ ~2 MB — sonst holt
  das Gerät ihn regulär), `art-ungueltig`, `schluessel-ungueltig` (auch `einstellung` mit anderem
  Schlüssel als `einstellungen`), `zeitstempel-ungueltig` (kein ISO 8601 mit Zone),
  `daten-ungueltig` (fehlt/null ohne `geloescht`), `zu-gross` (> 5 MB), `ungueltig`. Mehr als 1000
  Datensätze oder > 8 MB → 413. Zeitstempel mehr als 24 h in der Zukunft oder vor 2000 ersetzt der
  Server durch «jetzt» und meldet sie in `korrigiert`.
- `DELETE /api/daten` macht alle Datensätze zu Grabsteinen (neue Versionen, Zeitstempel jetzt),
  damit andere Geräte nachziehen, und beendet die Sitzungen der übrigen Geräte.
- `id_token`-Signatur wird nicht geprüft: Das Token kommt direkt per TLS vom Token-Endpunkt
  (OpenID Connect Core 3.1.3.7, Punkt 6); geprüft werden iss, aud, exp, nonce, email_verified.

## Hostpoint

- Konfiguration: `LERNAPP_CONFIG`, sonst `<Home>/private/lernapp/config.php` (Home =
  drei Ebenen über `api/`, also `/home/<konto>`).
- `.user.ini` hebt `post_max_size` auf 12 MB (PHP-FPM).
- Apache mit PHP-FPM reicht den Header `Authorization` nur mit `CGIPassAuth On` (oder einer
  Rewrite-Regel `E=HTTP_AUTHORIZATION`) weiter — nötig für `/api/admin/migrieren`.
