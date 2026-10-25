/**
 * Zugriff auf die eigene PHP-API unter /api (gleiche Herkunft, Sitzungs-Cookie).
 * Ändernde Anfragen tragen den Header «X-Lernapp: 1» (Schutz vor CSRF).
 */

/** Konto, für das dieser Tab Daten hat (Kennung vom Server); null = unbekannt. */
let aktivesKonto: string | null = null;

/**
 * Setzt das Konto dieses Tabs. Jede Anfrage trägt es als «X-Lernapp-Konto»; gehört das
 * Sitzungs-Cookie inzwischen einer anderen Person (anderer Tab), lehnt der Server
 * Sync und Löschen mit 409 «anderes-konto» ab.
 */
export function setzeKonto(konto: string | null): void {
  aktivesKonto = konto || null;
}

/** Der Server hat geantwortet, aber mit einem Fehlerstatus. */
export class ApiFehler extends Error {
  constructor(
    readonly status: number,
    /** Fehlercode aus {"fehler": …}, falls vorhanden. */
    readonly code: string | null,
    meldung: string,
  ) {
    super(meldung);
    this.name = 'ApiFehler';
  }
}

/** Keine (brauchbare) Antwort: offline, Zeitüberschreitung oder keine API hinter /api. */
export class NetzFehler extends Error {
  constructor(meldung: string) {
    super(meldung);
    this.name = 'NetzFehler';
  }
}

export interface ApiOptionen {
  methode?: 'GET' | 'POST' | 'DELETE';
  /** Wird als JSON gesendet. POST ohne body sendet `{}`. */
  body?: unknown;
  /** Abbruch nach so vielen ms (Standard 30 s). */
  zeitlimit?: number;
}

/**
 * Ruft die API auf und liefert die JSON-Antwort (null bei 204). Wirft ApiFehler
 * (Status ≥ 400) oder NetzFehler (keine Verbindung oder kein JSON — z. B. wenn
 * statt der API die App-Seite zurückkommt).
 */
export async function rufeApi<T = unknown>(pfad: string, opt: ApiOptionen = {}): Promise<T> {
  const methode = opt.methode ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: string | undefined;
  if (methode !== 'GET') headers['X-Lernapp'] = '1';
  if (aktivesKonto) headers['X-Lernapp-Konto'] = aktivesKonto;
  if (opt.body !== undefined || methode === 'POST') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opt.body ?? {});
  }
  let antwort: Response;
  try {
    antwort = await fetch(pfad, {
      method: methode,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(opt.zeitlimit ?? 30_000),
    });
  } catch (e) {
    throw new NetzFehler(e instanceof Error ? e.message : String(e));
  }
  if (antwort.status === 204) return null as T;
  const istJson = (antwort.headers.get('Content-Type') ?? '').includes('application/json');
  let daten: unknown = null;
  if (istJson) {
    // Abbruch beim Lesen (Zeitlimit, Verbindung weg) ist ein Netzfehler — später neu versuchen.
    let text: string;
    try {
      text = await antwort.text();
    } catch (e) {
      throw new NetzFehler(e instanceof Error ? e.message : String(e));
    }
    // Kaputtes JSON vom Server bleibt dagegen null (→ Fehler beim Aufrufer).
    try {
      daten = text ? JSON.parse(text) : null;
    } catch {
      daten = null;
    }
  }
  if (!antwort.ok) {
    // 5xx ohne JSON: Proxy/Server nicht erreichbar → wie offline behandeln
    if (!istJson && antwort.status >= 500) throw new NetzFehler(`HTTP ${antwort.status}`);
    const f = (daten ?? {}) as { fehler?: unknown; meldung?: unknown };
    throw new ApiFehler(
      antwort.status,
      typeof f.fehler === 'string' ? f.fehler : null,
      typeof f.meldung === 'string' ? f.meldung : `HTTP ${antwort.status}`,
    );
  }
  if (!istJson) throw new NetzFehler('Keine JSON-Antwort von der API');
  return daten as T;
}

/** Im Browser ist inzwischen ein anderes Konto angemeldet als in diesem Tab (409). */
export function istAnderesKonto(e: unknown): boolean {
  return e instanceof ApiFehler && e.status === 409 && e.code === 'anderes-konto';
}

/** Sitzung fehlt/abgelaufen (401) oder Adresse nicht (mehr) freigegeben (403 nicht-freigegeben). */
export function istAbgemeldet(e: unknown): boolean {
  return e instanceof ApiFehler && (e.status === 401 || (e.status === 403 && e.code === 'nicht-freigegeben'));
}
