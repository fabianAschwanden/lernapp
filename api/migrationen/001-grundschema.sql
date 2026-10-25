-- Grundschema der Lernapp. {{praefix}} wird durch tabellen_praefix ersetzt (Standard «lernapp_»),
-- weil sich die Datenbank evtl. mit anderen Projekten teilt.
-- Jede Anweisung endet mit «;» am Zeilenende; keine Semikolons in Texten.
-- art/schluessel sind binär sortiert: Schlüssel unterscheiden Gross-/Kleinschreibung und Leerzeichen am Ende.

CREATE TABLE IF NOT EXISTS {{praefix}}benutzer (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  google_sub VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  email VARCHAR(320) NOT NULL,
  name VARCHAR(200) NOT NULL DEFAULT '',
  sync_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  erstellt_am DATETIME NOT NULL,
  letzte_anmeldung DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY google_sub (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {{praefix}}sitzungen (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  benutzer_id BIGINT UNSIGNED NOT NULL,
  erstellt_am DATETIME NOT NULL,
  ablauf DATETIME NOT NULL,
  zuletzt_genutzt DATETIME NOT NULL,
  PRIMARY KEY (token_hash),
  KEY benutzer (benutzer_id),
  KEY ablauf (ablauf),
  FOREIGN KEY (benutzer_id) REFERENCES {{praefix}}benutzer (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {{praefix}}datensaetze (
  benutzer_id BIGINT UNSIGNED NOT NULL,
  art VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  schluessel VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  daten LONGTEXT NULL,
  geaendert_am DATETIME(3) NOT NULL,
  geloescht TINYINT(1) NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (benutzer_id, art, schluessel),
  KEY benutzer_version (benutzer_id, version),
  FOREIGN KEY (benutzer_id) REFERENCES {{praefix}}benutzer (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Zustand eines laufenden Google-Logins (state, PKCE-Verifier, nonce), 10 Minuten gültig.
-- browser_hash bindet ihn an das Cookie des Browsers, der den Login gestartet hat.
CREATE TABLE IF NOT EXISTS {{praefix}}auth_zustand (
  zustand_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  browser_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_verifier VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nonce VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  zurueck VARCHAR(2048) NOT NULL,
  ablauf DATETIME NOT NULL,
  PRIMARY KEY (zustand_hash),
  KEY ablauf (ablauf)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
