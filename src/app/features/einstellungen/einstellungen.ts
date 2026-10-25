import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BackupService, ImportErgebnis } from '../../core/services/backup.service';
import { Einstellungen, EinstellungenService } from '../../core/services/einstellungen.service';
import { InstallationService } from '../../core/services/installation.service';
import { KiGeneratorService } from '../../core/services/ki-generator.service';
import { RueckmeldungService } from '../../core/services/rueckmeldung.service';
import { SpeicherService } from '../../core/services/speicher.service';

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

/** Einstellungen: Lernen, Darstellung, KI-Schlüssel, Backup, Installation, Erklärungen. */
@Component({
  selector: 'app-einstellungen',
  imports: [DecimalPipe, RouterLink],
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

  // Speicher
  readonly speicher = signal<Speicherstand | null>(null);
  readonly loeschenSchritt = signal<0 | 1>(0);

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
  }

  /** Springt zu einem Abschnitt (ohne die URL zu ändern). */
  springe(id: string): void {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.focus({ preventScroll: true });
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

  async allesLoeschen(): Promise<void> {
    if (!confirm('Wirklich alle Lektionen, deinen Lernstand, deine Rückmeldungen und die Einstellungen auf diesem Gerät löschen?')) {
      this.loeschenSchritt.set(0);
      return;
    }
    // Zuerst die Inhalte leeren — das klappt auch, wenn die offene Verbindung
    // das Löschen der ganzen Datenbank blockiert.
    try {
      const [lektionen, fortschritte, pruefungen, rueckmeldungen] = await Promise.all([
        this.db.alleLektionen(),
        this.db.alleFortschritte(),
        this.db.allePruefungen(),
        this.db.alleRueckmeldungen(),
      ]);
      for (const l of lektionen) await this.db.loescheLektion(l.id);
      for (const r of rueckmeldungen) await this.db.loescheRueckmeldung(r.id);
      const ids = new Set([...fortschritte, ...pruefungen].map((x) => x.lektionId));
      for (const id of ids) await this.db.loescheFortschritt(id);
      await this.db.entferne('einstellungen');
      await this.einstellungen.setzeApiSchluessel(null);
    } catch (e) {
      console.error(e);
    }
    await new Promise<void>((fertig) => {
      const anfrage = indexedDB.deleteDatabase('lernapp');
      anfrage.onsuccess = anfrage.onerror = () => fertig();
      // Eine offene Verbindung blockiert das Löschen; beim Neuladen wird sie geschlossen
      // und das Löschen läuft weiter.
      anfrage.onblocked = () => fertig();
    });
    location.reload();
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
