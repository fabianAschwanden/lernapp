-- Der Zustand eines laufenden Google-Logins liegt seit dieser Version in einem signierten
-- Cookie (api/lib/google.php). Die Tabelle entfällt: Ohne Anmeldung soll niemand Zeilen in
-- die (evtl. geteilte) Datenbank schreiben können.

DROP TABLE IF EXISTS {{praefix}}auth_zustand;
