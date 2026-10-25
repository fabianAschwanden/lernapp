import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { NurLokal } from '../domain/sync';
import { ApiFehler, NetzFehler, istAbgemeldet, rufeApi, setzeKonto } from './api';
import { SEITE } from './seite';
import { SpeicherService } from './speicher.service';
import { SyncService } from './sync.service';

export { SEITE } from './seite';

/**
 * - pruefe: Start ohne frühere Anmeldung, wartet auf den Server
 * - vorlaeufig: Start mit früherer Anmeldung — App sofort nutzbar, der Server wird im Hintergrund gefragt
 * - laedt / ladefehler: erste Anmeldung auf dem Gerät, die Daten vom Server kommen noch
 * - angemeldet, offline: normal nutzbar
 * - abgelaufen: Sitzung abgelaufen, App bleibt lokal nutzbar (Änderungen bleiben im Ausgang)
 * - personenwechsel: eine andere Person hat sich angemeldet, auf dem Gerät liegen noch
 *   nicht hochgeladene Daten der vorherigen — wartet auf die Entscheidung
 * - abgemeldet
 */
export type AuthZustand =
  | 'pruefe'
  | 'vorlaeufig'
  | 'laedt'
  | 'ladefehler'
  | 'angemeldet'
  | 'offline'
  | 'abgelaufen'
  | 'personenwechsel'
  | 'abgemeldet';

export interface Benutzer {
  email: string;
  name: string;
  /** Stabile Kennung des Kontos vom Server (bleibt bei geänderter Google-Adresse gleich). */
  konto: string;
}

/** Was beim Abmelden bzw. Personenwechsel verloren ginge. */
export interface OffeneDaten {
  /** Änderungen im Ausgang (noch nicht hochgeladen). */
  ausstehend: number;
  /** Datensätze, die nicht synchronisiert werden konnten und nur auf dem Gerät liegen. */
  nurLokal: NurLokal[];
}

/** Rückfrage beim Personenwechsel: Daten der vorherigen Person liegen noch auf dem Gerät. */
export interface Personenwechsel extends OffeneDaten {
  vorher: { email: string; name: string };
  nachher: { email: string; name: string };
}

/** Schlüssel im Einstellungs-Speicher: zuletzt auf diesem Gerät angemeldete Person. */
export const KONTO_SCHLUESSEL = 'konto';
/** localStorage: Abmeldung offline begonnen, Server-Sitzung muss noch beendet werden. */
const ABMELDEN_AUSSTEHEND = 'lernapp-abmelden-ausstehend';
/** So lange wartet der Start ohne frühere Anmeldung höchstens auf /api/ich, dann gilt das Gerät als offline. */
const ICH_ZEITLIMIT_MS = 8000;
/** Mit früherer Anmeldung: schneller auf «offline» wechseln (die App läuft ja schon). */
const ICH_ZEITLIMIT_MIT_KONTO_MS = 3000;
/** Offline: so oft prüfen, ob der Server wieder erreichbar ist. */
const OFFLINE_PRUEFEN_MS = 2 * 60 * 1000;
/**
 * Nach dem online-Ereignis zusätzlich nach so vielen ms nochmals prüfen: Das Ereignis
 * kommt oft, bevor die Verbindung wirklich steht (WLAN verbunden, Adresse noch nicht).
 */
const NACH_ONLINE_PRUEFEN_MS = [3000, 15_000];
/** Kanal zwischen den Tabs derselben App (Abmelden, Personenwechsel). */
const KANAL = 'lernapp';

type Marker = { email: string; name: string; konto?: string };
type Nachricht = { typ: 'abmelden' } | { typ: 'abgemeldet' } | { typ: 'angemeldet'; konto: string };

/**
 * Nur relative Pfade innerhalb der App (beginnend mit «/», nicht «//» oder «/\»),
 * nie die Anmeldeseite oder die API selbst — sonst «/».
 */
export function sichererZurueckPfad(pfad: unknown): string {
  if (typeof pfad !== 'string' || !pfad.startsWith('/') || pfad.startsWith('//') || pfad.startsWith('/\\')) return '/';
  if (/^\/(anmelden|api)(?=$|[/?#])/.test(pfad)) return '/';
  return pfad;
}

function gleicheAdresse(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Antwort von /api/ich bzw. /api/test/anmelden. */
function istBenutzer(x: unknown): x is Benutzer {
  const b = x as Partial<Benutzer> | null;
  return istMarker(b) && typeof b.konto === 'string' && !!b.konto;
}

/** Konto-Marker auf dem Gerät (ältere Versionen ohne `konto`). */
function istMarker(x: unknown): x is Marker {
  const b = x as Partial<Marker> | null;
  return !!b && typeof b.email === 'string' && !!b.email && typeof b.name === 'string';
}

/** Andere Person als der Marker? Über die Kontokennung, bei alten Markern über die Adresse. */
function istAnderePerson(marker: Marker, ich: Benutzer): boolean {
  return marker.konto ? marker.konto !== ich.konto : !gleicheAdresse(marker.email, ich.email);
}

/**
 * Anmeldung mit Google über die eigene API (Sitzungs-Cookie). Nach einer
 * Anmeldung merkt sich das Gerät die Person: Ohne Netz bleibt die App dann
 * nutzbar («offline»), Änderungen werden später synchronisiert.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly speicher = inject(SpeicherService);
  private readonly sync = inject(SyncService);
  private readonly router = inject(Router);
  private readonly seite = inject(SEITE);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _zustand = signal<AuthZustand>('pruefe');
  private readonly _benutzer = signal<Benutzer | null>(null);
  readonly zustand = this._zustand.asReadonly();
  readonly benutzer = this._benutzer.asReadonly();
  /** Abgemeldet, weil der Server nicht erreichbar ist (und keine frühere Anmeldung auf dem Gerät). */
  readonly keinNetz = signal(false);
  /** Läuft gerade eine erneute Prüfung (Knopf «Nochmals versuchen»)? */
  readonly prueftErneut = signal(false);
  /** Rückfrage beim Personenwechsel (Zustand «personenwechsel»). */
  readonly wechsel = signal<Personenwechsel | null>(null);

  /** Fehlercode, wenn der Server die Anmeldung ablehnt (z. B. «nicht-freigegeben», «abgelaufen»). */
  readonly fehler = signal<string | null>(null);

  private pruefung: Promise<void> | null = null;
  private hintergrund: Promise<void> | null = null;
  private prueftGerade = false;
  private offlineTakt: ReturnType<typeof setInterval> | null = null;
  private nachOnline: ReturnType<typeof setTimeout>[] = [];
  private lauscht = false;
  private kanal: BroadcastChannel | null = null;
  /** Erste Anmeldung: Person hat «Trotzdem offline weiter» gewählt — nicht nochmals blockieren. */
  private ersterUebersprungen = false;
  private ladeWahl: ((wahl: 'nochmal' | 'offline') => void) | null = null;
  private wechselWahl: ((wahl: 'verwerfen' | 'abbrechen') => void) | null = null;

  /** Prüft beim App-Start die Anmeldung (einmalig). */
  starte(): Promise<void> {
    this.pruefung ??= this.pruefen();
    return this.pruefung;
  }

  /** Wartet, bis der Anmeldestatus feststeht. */
  bereit(): Promise<void> {
    return this.starte();
  }

  /** Darf die App benutzt werden? (auch offline, vorläufig und mit abgelaufener Sitzung) */
  istDrin(): boolean {
    const z = this._zustand();
    return z === 'angemeldet' || z === 'offline' || z === 'vorlaeufig' || z === 'abgelaufen';
  }

  /** Adresse zum Starten der Google-Anmeldung. */
  anmeldeUrl(zurueck?: string): string {
    return `/api/auth/google/start?zurueck=${encodeURIComponent(sichererZurueckPfad(zurueck))}`;
  }

  anmelden(zurueck?: string): void {
    this.seite.gehe(this.anmeldeUrl(zurueck));
  }

  /** Was beim Abmelden verloren ginge (Ausgang und nicht synchronisierbare Datensätze). */
  async offeneDaten(): Promise<OffeneDaten> {
    const [ausstehend, nurLokal] = await Promise.all([
      this.speicher.ausgangAnzahl().catch(() => 0),
      this.speicher.nurLokal().catch(() => [] as NurLokal[]),
    ]);
    return { ausstehend, nurLokal };
  }

  /**
   * Meldet ab: zuerst ausstehende Änderungen hochladen, dann die Sitzung beenden
   * und alle Daten dieses Geräts entfernen (inkl. API-Schlüssel). Liegen danach noch
   * Änderungen im Ausgang oder Datensätze, die nur auf dem Gerät liegen, kommen sie
   * ohne `trotzAusstehend` zurück, und nichts passiert. `ueberall` beendet alle
   * Sitzungen der Person (geht nur online; sonst kommt `fehler: 'offline'`).
   */
  async abmelden(
    opt: { trotzAusstehend?: boolean; ueberall?: boolean } = {},
  ): Promise<(OffeneDaten & { fehler?: 'offline' }) | null> {
    if (this._zustand() === 'angemeldet') await this.sync.synchronisieren();
    const offen = await this.offeneDaten();
    if ((offen.ausstehend > 0 || offen.nurLokal.length > 0) && !opt.trotzAusstehend) return offen;
    if (opt.ueberall) {
      try {
        await rufeApi('/api/auth/abmelden-ueberall', { methode: 'POST', zeitlimit: 10_000 });
      } catch (e) {
        if (e instanceof NetzFehler) return { ...offen, fehler: 'offline' };
        if (!(e instanceof ApiFehler && e.status === 401)) throw e;
      }
    }
    this.sync.stop();
    this.stoppeOfflineTakt();
    setzeKonto(null);
    this.speicher.setzeKonto(null);
    // Andere Tabs zeigen sonst weiter die Daten an und schrieben sie in den Ausgang zurück:
    // erst anhalten, nach dem Löschen neu laden (vorher fänden sie noch Sitzung und Daten vor).
    this.sende({ typ: 'abmelden' });
    if (!opt.ueberall && !(await this.beendeSitzung())) merke(ABMELDEN_AUSSTEHEND, true);
    await this.speicher.leereAlles().catch((e) => console.warn('Lokale Daten konnten nicht gelöscht werden', e));
    this.sende({ typ: 'abgemeldet' });
    this.seite.gehe('/anmelden');
    return null;
  }

  /**
   * Der Server nimmt die Sitzung nicht mehr an. Läuft die App schon (z. B. mitten in
   * einer Probeprüfung), bleibt sie lokal nutzbar («abgelaufen», Hinweis im Kopf) — kein
   * Seitenwechsel, keine Rückfrage, nichts geht verloren. Mit `sofort` (ausdrückliche
   * Handlung) bzw. bei entzogener Freigabe geht es direkt zur Anmeldeseite.
   */
  abgemeldetErkannt(fehler?: string, opt: { sofort?: boolean } = {}): void {
    this.sync.stop('ausstehend');
    this.stoppeOfflineTakt();
    setzeKonto(null);
    const code = fehler ?? 'abgelaufen';
    this.fehler.set(code);
    this.keinNetz.set(false);
    if (!opt.sofort && code !== 'nicht-freigegeben' && this.istDrin()) {
      this._zustand.set('abgelaufen');
      return;
    }
    this._zustand.set('abgemeldet');
    const url = this.router.url;
    if (url.startsWith('/anmelden')) return;
    const zurueck = sichererZurueckPfad(url);
    void this.router.navigate(['/anmelden'], {
      queryParams: { ...(zurueck !== '/' ? { zurueck } : {}), fehler: code },
    });
  }

  /** Knopf «Nochmals versuchen» auf der Anmeldeseite (ohne Netz). */
  nochmalsPruefen(): void {
    this.erneutPruefen(true);
  }

  /** Erster Abgleich fehlgeschlagen: nochmals versuchen bzw. ohne die Serverdaten weiter. */
  ersterAbgleichWahl(wahl: 'nochmal' | 'offline'): void {
    this.ladeWahl?.(wahl);
  }

  /** Personenwechsel: Daten der vorherigen Person verwerfen bzw. abbrechen. */
  personenwechselWahl(wahl: 'verwerfen' | 'abbrechen'): void {
    this.wechselWahl?.(wahl);
  }

  private async pruefen(erneut = false): Promise<void> {
    this.lauscheAufNetz();
    // Abmeldung von früher (offline) zuerst beim Server nachholen.
    if (lies(ABMELDEN_AUSSTEHEND)) {
      if (await this.beendeSitzung()) merke(ABMELDEN_AUSSTEHEND, false);
      else this.keinNetz.set(true);
      this._zustand.set('abgemeldet');
      return;
    }
    const gelesen = await this.speicher.lies<Marker>(KONTO_SCHLUESSEL).catch(() => undefined);
    const marker = istMarker(gelesen) ? gelesen : null;
    // Früher hier angemeldet und schon einmal vollständig abgeglichen: App sofort freigeben,
    // den Server im Hintergrund fragen (schlechtes Netz soll den Start nicht blockieren).
    if (!erneut && marker && (await this.speicher.syncZuletzt().catch(() => null))) {
      this._benutzer.set({ email: marker.email, name: marker.name, konto: marker.konto ?? '' });
      this.speicher.setzeKonto(marker.konto ?? null);
      this._zustand.set('vorlaeufig');
      this.hintergrund = this.pruefeServer(marker).finally(() => (this.hintergrund = null));
      return;
    }
    await this.pruefeServer(marker);
  }

  /** Fragt /api/ich und übernimmt das Ergebnis. */
  private async pruefeServer(marker: Marker | null): Promise<void> {
    const laeuftSchon = this.istDrin();
    let ich: unknown;
    try {
      ich = await rufeApi('/api/ich', { zeitlimit: marker ? ICH_ZEITLIMIT_MIT_KONTO_MS : ICH_ZEITLIMIT_MS });
    } catch (e) {
      if (istAbgemeldet(e) || (e instanceof ApiFehler && e.status < 500)) {
        const code = e instanceof ApiFehler && e.code === 'nicht-freigegeben' ? e.code : marker ? 'abgelaufen' : null;
        // Die App läuft schon (vorläufig, offline): nicht still verschwinden lassen.
        if (laeuftSchon) {
          this.abgemeldetErkannt(code ?? undefined);
          return;
        }
        this.fehler.set(code);
        this.keinNetz.set(false);
        this._zustand.set('abgemeldet');
        return;
      }
      // Netzwerk- oder Serverfehler: mit früherer Anmeldung offline weiterarbeiten.
      this.gehOffline(marker);
      return;
    }
    if (!istBenutzer(ich)) {
      this.gehOffline(marker);
      return;
    }
    await this.uebernehmeAnmeldung(ich, marker, laeuftSchon);
  }

  /**
   * Erfolgreich angemeldet. Andere Person als zuletzt auf dem Gerät → lokale Daten
   * zuerst löschen (keine Vermischung; liegen noch nicht hochgeladene Daten da, erst nach
   * Rückfrage). Erste Anmeldung auf dem Gerät → vorhandene Daten (Version ohne Server,
   * Backup) hochladen und die Daten vom Server abwarten, bevor die App freigegeben wird.
   */
  private async uebernehmeAnmeldung(ich: Benutzer, marker: Marker | null, laeuftSchon: boolean): Promise<void> {
    await this.sync.diensteGeladen();
    if (marker && istAnderePerson(marker, ich)) {
      const offen = await this.offeneDaten();
      if (offen.ausstehend || offen.nurLokal.length) {
        const wahl = await this.frageWechsel(marker, ich, offen, laeuftSchon);
        if (wahl === 'abbrechen') {
          // Sitzung der neuen Person beenden und neu anmelden (Google fragt nach dem Konto).
          await this.beendeSitzung();
          this.seite.gehe(this.anmeldeUrl(this.router.url));
          return;
        }
      }
      await this.speicher.leereAlles();
      if (laeuftSchon || this.wechsel()) {
        // Die Seite zeigt noch die Daten der vorherigen Person: frisch starten.
        await this.merkeKonto(ich);
        this.seite.neuLaden();
        return;
      }
      await this.sync.diensteNeuLaden();
    } else if (!marker) {
      this.speicher.setzeKonto(ich.konto);
      await this.speicher.allesInAusgang();
    }
    setzeKonto(ich.konto);
    this.speicher.setzeKonto(ich.konto);
    await this.merkeKonto(ich);
    this.stoppeOfflineTakt();
    this._benutzer.set(ich);
    this.keinNetz.set(false);
    this.fehler.set(null);

    const erster = !laeuftSchon && !this.ersterUebersprungen && !(await this.speicher.syncZuletzt().catch(() => null));
    const beiAbmeldung = (fehler?: string) => this.abgemeldetErkannt(fehler);
    if (!erster) {
      this._zustand.set('angemeldet');
      void this.sync.start(beiAbmeldung);
      return;
    }
    // Erste Anmeldung auf dem Gerät: Bis die Daten vom Server da sind, wären Lernstand und
    // Einstellungen leer — Änderungen darauf überschrieben neuere Stände auf allen Geräten.
    this._zustand.set('laedt');
    await this.sync.start(beiAbmeldung);
    while (!this.sync.letzterLaufOk()) {
      if (this._zustand() !== 'laedt') return; // z. B. Sitzung abgelaufen, Seite wird neu geladen
      this._zustand.set('ladefehler');
      const wahl = await new Promise<'nochmal' | 'offline'>((ok) => (this.ladeWahl = ok));
      this.ladeWahl = null;
      if (wahl === 'offline') {
        this.ersterUebersprungen = true;
        this.gehOffline(ich);
        return;
      }
      this._zustand.set('laedt');
      await this.sync.synchronisieren();
    }
    if (this._zustand() === 'laedt') this._zustand.set('angemeldet');
  }

  /** Zeigt die Rückfrage zum Personenwechsel und wartet auf die Entscheidung. */
  private async frageWechsel(
    vorher: Marker,
    nachher: Benutzer,
    offen: OffeneDaten,
    laeuftSchon: boolean,
  ): Promise<'verwerfen' | 'abbrechen'> {
    this.sync.stop('ausstehend');
    this.stoppeOfflineTakt();
    setzeKonto(null);
    this.speicher.setzeKonto(null);
    this.wechsel.set({
      ...offen,
      vorher: { email: vorher.email, name: vorher.name },
      nachher: { email: nachher.email, name: nachher.name },
    });
    this._zustand.set('personenwechsel');
    if (laeuftSchon) void this.router.navigate(['/anmelden']);
    const wahl = await new Promise<'verwerfen' | 'abbrechen'>((ok) => (this.wechselWahl = ok));
    this.wechselWahl = null;
    return wahl;
  }

  /** Merkt die Person auf dem Gerät und meldet sie den anderen Tabs. */
  private async merkeKonto(ich: Benutzer): Promise<void> {
    await this.speicher.schreibe<Marker>(KONTO_SCHLUESSEL, { konto: ich.konto, email: ich.email, name: ich.name });
    this.sende({ typ: 'angemeldet', konto: ich.konto });
  }

  private gehOffline(marker: Marker | null): void {
    this.sync.stop('offline');
    if (!marker) {
      this.keinNetz.set(true);
      this._zustand.set('abgemeldet');
      return;
    }
    setzeKonto(marker.konto ?? null);
    this.speicher.setzeKonto(marker.konto ?? null);
    this._benutzer.set({ email: marker.email, name: marker.name, konto: marker.konto ?? '' });
    this._zustand.set('offline');
    this.offlineTakt ??= setInterval(() => this.erneutPruefen(), OFFLINE_PRUEFEN_MS);
  }

  /** Offline oder ohne Netz abgemeldet: sobald wieder Netz da ist, neu prüfen. */
  private erneutPruefen(sichtbar = false): void {
    const z = this._zustand();
    if (this.prueftGerade || this.hintergrund || (z !== 'offline' && !(z === 'abgemeldet' && this.keinNetz()))) return;
    this.prueftGerade = true;
    if (sichtbar) this.prueftErneut.set(true);
    this.pruefung = this.pruefen(true).finally(() => {
      this.prueftGerade = false;
      this.prueftErneut.set(false);
    });
  }

  private lauscheAufNetz(): void {
    if (this.lauscht) return;
    this.lauscht = true;
    const online = () => {
      this.erneutPruefen();
      this.nachOnline.forEach(clearTimeout);
      this.nachOnline = NACH_ONLINE_PRUEFEN_MS.map((ms) => setTimeout(() => this.erneutPruefen(), ms));
    };
    const sichtbar = () => {
      if (document.visibilityState === 'visible') this.erneutPruefen();
    };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', sichtbar);
    try {
      this.kanal = new BroadcastChannel(KANAL);
      this.kanal.onmessage = (e: MessageEvent<Nachricht>) => this.empfange(e.data);
    } catch {
      this.kanal = null; // ohne BroadcastChannel: dann prüft der Server (X-Lernapp-Konto)
    }
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', sichtbar);
      this.nachOnline.forEach(clearTimeout);
      this.stoppeOfflineTakt();
      this.kanal?.close();
    });
  }

  /**
   * Ein anderer Tab hat abgemeldet bzw. eine andere Person angemeldet: Dieser Tab hat noch
   * die alten Daten im Speicher — nichts mehr schreiben, neu laden. (Ungesicherte Eingaben
   * in diesem Tab gehen dabei verloren; die Daten der anderen Person dürfen nicht bleiben.)
   */
  private empfange(n: Nachricht | null | undefined): void {
    const b = this._benutzer();
    if (!n || !b) return;
    if (n.typ === 'abmelden') {
      this.sync.stop('ausstehend');
      return;
    }
    if (n.typ === 'abgemeldet' || (n.typ === 'angemeldet' && n.konto !== b.konto)) {
      this.sync.stop();
      this.seite.neuLaden();
    }
  }

  private sende(n: Nachricht): void {
    try {
      this.kanal?.postMessage(n);
    } catch {
      // Kanal schon geschlossen: egal
    }
  }

  private stoppeOfflineTakt(): void {
    if (this.offlineTakt) clearInterval(this.offlineTakt);
    this.offlineTakt = null;
  }

  /** Beendet die Sitzung auf dem Server. true, wenn sie sicher weg ist. */
  private async beendeSitzung(): Promise<boolean> {
    try {
      await rufeApi('/api/auth/abmelden', { methode: 'POST', zeitlimit: 10_000 });
      return true;
    } catch (e) {
      return e instanceof ApiFehler && e.status === 401;
    }
  }
}

function lies(schluessel: string): boolean {
  try {
    return localStorage.getItem(schluessel) === '1';
  } catch {
    return false;
  }
}

function merke(schluessel: string, wert: boolean): void {
  try {
    if (wert) localStorage.setItem(schluessel, '1');
    else localStorage.removeItem(schluessel);
  } catch {
    // ohne localStorage: dann eben nicht
  }
}

/**
 * Guard für alle Seiten ausser der Anmeldung: angemeldet (oder offline nach
 * einer früheren Anmeldung) → weiter, sonst zur Anmeldeseite mit Rücksprung.
 */
export const nurAngemeldet: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.bereit();
  if (auth.istDrin()) return true;
  // Den Grund (z. B. «abgelaufen») zeigt die Anmeldeseite aus auth.fehler().
  const zurueck = sichererZurueckPfad(state.url);
  return router.createUrlTree(['/anmelden'], { queryParams: zurueck !== '/' ? { zurueck } : {} });
};
