-- Epoche des Sync-Zählers pro Person: wechselt, wenn die Datenbank zurückgesetzt wird
-- (Wiederherstellung aus einem Backup). Geräte, die eine andere Epoche kennen, gleichen dann
-- vollständig ab, statt Änderungen mit kleinerer Version zu übersehen.
-- Nach jeder Wiederherstellung: UPDATE <praefix>benutzer SET sync_epoche = SUBSTRING(MD5(RAND()), 1, 16)

ALTER TABLE {{praefix}}benutzer ADD COLUMN IF NOT EXISTS sync_epoche CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' AFTER sync_version;

UPDATE {{praefix}}benutzer SET sync_epoche = SUBSTRING(MD5(RAND()), 1, 16) WHERE sync_epoche = '';
