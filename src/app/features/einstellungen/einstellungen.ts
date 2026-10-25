import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NurLokal } from '../../core/domain/sync';
import { ApiFehler, NetzFehler, istAbgemeldet, istAnderesKonto, rufeApi } from '../../core/services/api';
import { AuthService, KONTO_SCHLUESSEL, SEITE } from '../../core/services/auth.service';
import { BackupService, ImportErgebnis } from '../../core/services/backup.service';
import { Einstellungen, EinstellungenService } from '../../core/services/einstellungen.service';
import { InstallationService } from '../../core/services/installation.service';
import { KiGeneratorService } from '../../core/services/ki-generator.service';
import { RueckmeldungService } from '../../core/services/rueckmeldung.service';
import { SpeicherService } from '../../core/services/speicher.service';
import { SyncService, bezeichnung } from '../../core/services/sync.service';

interface Speicherstand {
  belegt?: number;
  verfuegbar?: number;
  dauerhaft: boolean | null;
}

export const MODELLE = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', text: 'Standard, beste Qualität' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', text: 'günstiger' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', text: 'am günstigsten' },
] as const;

const FARBSCHEMATA: { w: Einstellungen['farbschema']; t: string }[] = [
  { w: 'auto', t: 'Wie das Gerät' },
  { w: 'hell', t: 'Hell' },
  { w: 'dunkel', t: 'Dunkel' },
];

const LEITNER = [
  { fach: 1, abstand: 'sofort wieder (in der nächsten Runde)' },
  { fach: 2, abstand: 'nach 1 Tag' },
  { fach: 3, abstand: 'nach 3 Tagen' },
  { fach: 4, abstand: 'nach 7 Tagen' },
  { fach: 5, abstand: 'nach 14 Tagen' },
];

/** Einstellungen: Konto, Lernen, Darstellung, KI-Schlüssel, Backup, Installation, Erklärungen. */
@Component({
  selector: 'app-einstellungen',
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './einstellungen.html',
  styleUrl: './einstellungen.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EinstellungenSeite {
  private readonly einstellungen = inject(EinstellungenService);
  private readonly backup = inject(BackupService);
  private readonly ki = inject(KiGeneratorService);
  private readonly db = inject(SpeicherService);
  private readonly rueckmeldungService = inject(RueckmeldungService);
  private readonly auth = inject(AuthService);
  private readonly seite = inject(SEITE);
  readonly sync = inject(SyncService);

  readonly modelle = MODELLE;
  readonly leitner = LEITNER;
  readonly farbschemata = FARBSCHEMATA;
  readonly werte = this.einstellungen.werte;
  readonly hatSchluessel = this.einstellungen.hatApiSchluessel;
  readonly anzahlRueckmeldungen = computed(() => this.rueckmeldungService.alle().length);

  // KI
  readonly schluesselEingabe = signal('');
  readonly schluesselZeigen = signal(false);
  readonly schluesselMeldung = signal<{ text: string; art: 'erfolg' | 'fehler' | 'info' } | null>(null);
  readonly prueftGerade = signal(false);

  // Backup
  readonly backupLaeuft = signal(false);
  readonly importErgebnis = signal<ImportErgebnis | null>(null);
  readonly backupFehler = signal<string | null>(null);

  // Konto
  readonly benutzer = this.auth.benutzer;
  readonly authZustand = this.auth.zustand;
  readonly abmeldenSchritt = signal<0 | 1>(0);
  readonly abmeldenLaeuft = signal(false);
  /** Anzahl Änderungen, die beim Abmelden nicht hochgeladen werden konnten. */
  readonly abmeldenAusstehend = signal(0);
  /** Datensätze, die nur auf diesem Gerät liegen (beim Abmelden verloren). */
  readonly abmeldenNurLokal = signal<NurLokal[]>([]);
  readonly abmeldenFehler = signal<string | null>(null);
  /** Warum nicht hochgeladen werden konnte — nach dem Versuch beim Abmelden aktuell. */
  readonly abmeldenGrund = computed(() => {
    switch (this.sync.status()) {
      case 'offline':
        return ' (du bist offline)';
      case 'fehler':
        return ' (der Server hat einen Fehler gemeldet – versuch es später nochmals)';
      default:
        return '';
    }
  });
  /** Einmalige Ansage nach «Jetzt synchronisieren» (der Status selbst ist keine Live-Region). */
  readonly syncAnsage = signal('');
  private readonly abmeldenAbbrechenKnopf = viewChild<ElementRef<HTMLButtonElement>>('abmeldenAbbrechenKnopf');
  readonly syncText = computed(() => {
    const n = this.sync.ausstehend();
    switch (this.sync.status()) {
      case 'laeuft':
        return 'Synchronisiere …';
      case 'offline':
        return 'Offline – Änderungen werden später synchronisiert';
      case 'fehler':
        return 'Die letzte Synchronisation ist fehlgeschlagen';
      case 'ausstehend':
        return n === 1 ? '1 Änderung wartet auf die Synchronisation' : `${n} Änderungen warten auf die Synchronisation`;
      default:
        return 'Alles synchronisiert';
    }
  });

  // Speicher
  readonly speicher = signal<Speicherstand | null>(null);
  readonly loeschenSchritt = signal<0 | 1>(0);
  readonly loeschenFehler = signal<string | null>(null);

  // Installation (Ereignis wird global im InstallationService abgefangen)
  private readonly installation = inject(InstallationService);
  readonly kannInstallieren = this.installation.kannInstallieren;
  readonly istInstalliert = this.installation.istInstalliert;
  readonly installMeldung = signal<string | null>(null);

  readonly speicherAnteil = computed(() => {
    const s = this.speicher();
    return s?.belegt !== undefined && s.verfuegbar ? Math.min(100, (s.belegt / s.verfuegbar) * 100) : null;
  });

  constructor() {
    void this.ladeSpeicherstand();
    // Beim Öffnen der Abmelde-Rückfrage steht der Fokus auf dem sicheren «Abbrechen».
    effect(() => {
      if (this.abmeldenSchritt() === 1) this.abmeldenAbbrechenKnopf()?.nativeElement.focus();
    });
  }

  /** Springt zu einem Abschnitt (ohne die URL zu ändern). */
  springe(id: string): void {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.focus({ preventScroll: true });
  }

  // ---------- Konto ----------

  async jetztSynchronisieren(): Promise<void> {
    this.syncAnsage.set('');
    await this.sync.synchronisieren();
    this.syncAnsage.set(this.sync.status() === 'synchron' ? 'Synchronisiert.' : this.syncText());
  }

  /** Text zu einem Eintrag, der nur auf diesem Gerät liegt. */
  nurLokalText(e: NurLokal): string {
    return `${bezeichnung(e)} ${e.grund === 'zu-gross' ? 'ist zu gross für den Server' : 'wurde vom Server nicht angenommen'}`;
  }

  async abmelden(trotzAusstehend = false, ueberall = false): Promise<void> {
    this.abmeldenLaeuft.set(true);
    this.abmeldenFehler.set(null);
    try {
      const r = await this.auth.abmelden({ trotzAusstehend, ueberall });
      this.abmeldenAusstehend.set(r?.ausstehend ?? 0);
      this.abmeldenNurLokal.set(r?.nurLokal ?? []);
      if (r?.fehler === 'offline') {
        this.abmeldenFehler.set('Auf allen Geräten abmelden geht nur mit Internetverbindung.');
      }
    } catch (e) {
      console.warn(e);
      this.abmeldenFehler.set('Das Abmelden hat nicht geklappt. Versuch es später nochmals.');
    } finally {
      this.abmeldenLaeuft.set(false);
    }
  }

  /** Öffnet die Rückfrage und zeigt gleich, was nur auf diesem Gerät liegt. */
  async abmeldenOeffnen(): Promise<void> {
    this.abmeldenSchritt.set(1);
    this.abmeldenNurLokal.set((await this.auth.offeneDaten()).nurLokal);
  }

  abmeldenAbbrechen(): void {
    this.abmeldenSchritt.set(0);
    this.abmeldenAusstehend.set(0);
    this.abmeldenNurLokal.set([]);
    this.abmeldenFehler.set(null);
  }

  // ---------- Lernen & Darstellung ----------

  setzeZahl(feld: 'rundenGroesse' | 'pruefungAnzahl' | 'pruefungMinuten', e: Event, min: number, max: number): void {
    const eingabe = e.target as HTMLInputElement;
    const n = Number(eingabe.value);
    if (!eingabe.value.trim() || !Number.isFinite(n)) {
      eingabe.value = String(this.werte()[feld]);
      return;
    }
    const wert = Math.min(max, Math.max(min, Math.round(n)));
    eingabe.value = String(wert);
    void this.einstellungen.aendern({ [feld]: wert });
  }

  setzeFarbschema(schema: Einstellungen['farbschema']): void {
    void this.einstellungen.aendern({ farbschema: schema });
  }

  setzeModell(id: string): void {
    void this.einstellungen.aendern({ kiModell: id });
  }

  // ---------- KI-Schlüssel ----------

  text(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  async schluesselSpeichern(): Promise<void> {
    const wert = this.schluesselEingabe().trim();
    if (!wert) return;
    await this.einstellungen.setzeApiSchluessel(wert);
    this.schluesselEingabe.set('');
    this.schluesselZeigen.set(false);
    this.schluesselMeldung.set({ text: 'Schlüssel gespeichert. Er bleibt nur auf diesem Gerät.', art: 'erfolg' });
  }

  async schluesselEntfernen(): Promise<void> {
    if (!confirm('API-Schlüssel von diesem Gerät entfernen?')) return;
    await this.einstellungen.setzeApiSchluessel(null);
    this.schluesselMeldung.set({ text: 'Schlüssel entfernt.', art: 'info' });
  }

  /** Prüft den eingegebenen Schlüssel, sonst den gespeicherten. */
  async schluesselPruefen(): Promise<void> {
    const schluessel = this.schluesselEingabe().trim() || (await this.einstellungen.apiSchluessel());
    if (!schluessel) {
      this.schluesselMeldung.set({ text: 'Gib zuerst einen Schlüssel ein.', art: 'fehler' });
      return;
    }
    this.prueftGerade.set(true);
    this.schluesselMeldung.set({ text: 'Prüfe …', art: 'info' });
    try {
      const r = await this.ki.pruefeSchluessel(schluessel);
      this.schluesselMeldung.set(
        r.ok
          ? { text: 'Der Schlüssel funktioniert.', art: 'erfolg' }
          : { text: `Der Schlüssel funktioniert nicht: ${r.meldung}`, art: 'fehler' },
      );
    } catch (e) {
      console.error(e);
      this.schluesselMeldung.set({ text: 'Die Prüfung ist fehlgeschlagen. Bist du online?', art: 'fehler' });
    } finally {
      this.prueftGerade.set(false);
    }
  }

  // ---------- Backup ----------

  async exportieren(): Promise<void> {
    this.backupFehler.set(null);
    this.backupLaeuft.set(true);
    try {
      await this.backup.exportiere();
    } catch (e) {
      console.error(e);
      this.backupFehler.set('Das Backup konnte nicht erstellt werden.');
    } finally {
      this.backupLaeuft.set(false);
    }
  }

  async importieren(e: Event): Promise<void> {
    const eingabe = e.target as HTMLInputElement;
    const datei = eingabe.files?.[0];
    eingabe.value = '';
    if (!datei) return;
    this.backupFehler.set(null);
    this.importErgebnis.set(null);
    this.backupLaeuft.set(true);
    try {
      this.importErgebnis.set(await this.backup.importiere(datei));
      void this.ladeSpeicherstand();
    } catch (err) {
      this.backupFehler.set(err instanceof Error ? err.message : 'Der Import ist fehlgeschlagen.');
    } finally {
      this.backupLaeuft.set(false);
    }
  }

  // ---------- Speicher ----------

  async ladeSpeicherstand(): Promise<void> {
    const s = navigator.storage;
    if (!s) {
      this.speicher.set({ dauerhaft: null });
      return;
    }
    const [schaetzung, dauerhaft] = await Promise.all([
      s.estimate?.().catch(() => undefined),
      s.persisted?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    this.speicher.set({ belegt: schaetzung?.usage, verfuegbar: schaetzung?.quota, dauerhaft });
  }

  async dauerhaftSpeichern(): Promise<void> {
    const ok = await navigator.storage?.persist?.().catch(() => false);
    await this.ladeSpeicherstand();
    if (!ok) {
      this.speicher.update((s) => (s ? { ...s, dauerhaft: false } : s));
    }
  }

  /**
   * Löscht alle Daten auf dem Server und auf diesem Gerät. Die anderen Geräte
   * löschen sie bei ihrer nächsten Synchronisation (Grabsteine). Ohne Server
   * ginge es nicht: Die Daten kämen sonst beim nächsten Abgleich zurück.
   */
  async allesLoeschen(): Promise<void> {
    if (
      !confirm(
        'Wirklich alle Lektionen, deinen Lernstand, deine Rückmeldungen und die Einstellungen löschen — auf dem Server und auf all deinen Geräten?',
      )
    ) {
      this.loeschenSchritt.set(0);
      return;
    }
    this.loeschenFehler.set(null);
    try {
      await rufeApi('/api/daten', { methode: 'DELETE' });
    } catch (e) {
      if (istAnderesKonto(e)) {
        // In einem anderen Tab ist inzwischen eine andere Person angemeldet: nichts löschen.
        this.sync.stop('ausstehend');
        this.seite.neuLaden();
        return;
      }
      if (istAbgemeldet(e)) {
        this.auth.abgemeldetErkannt(e instanceof ApiFehler && e.code === 'nicht-freigegeben' ? e.code : undefined, {
          sofort: true,
        });
        return;
      }
      if (!(e instanceof NetzFehler)) console.warn('Löschen auf dem Server fehlgeschlagen', e);
      this.loeschenFehler.set(
        e instanceof NetzFehler
          ? 'Zum Löschen brauchst du eine Internetverbindung — sonst kämen die Daten vom Server zurück.'
          : 'Die Daten konnten auf dem Server nicht gelöscht werden. Versuch es später nochmals.',
      );
      return;
    }
    this.sync.stop('synchron');
    try {
      // Konto-Marker bleibt: Es ist weiterhin dieselbe Person angemeldet.
      await this.db.leereAlles([KONTO_SCHLUESSEL]);
    } catch (e) {
      console.warn(e);
    }
    this.seite.neuLaden();
  }

  // ---------- Installation ----------

  async installieren(): Promise<void> {
    const ergebnis = await this.installation.installieren();
    if (ergebnis === null) return;
    this.installMeldung.set(ergebnis ? 'Die App wird installiert.' : 'Installation abgebrochen.');
  }

  mb(bytes: number | undefined): number {
    return (bytes ?? 0) / 1024 / 1024;
  }
}
