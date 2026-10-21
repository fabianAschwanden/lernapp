import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { ergaenzeLektion, validiereLektion } from '../../core/domain/lektion-validierung';
import { KiAuftrag, kopierPrompt } from '../../core/ki/ki-prompt';
import { FRAGE_TYPEN } from '../../core/ki/ki-schema';
import { UmwandlungsErgebnis, parseKiJson, wandleKiAntwort } from '../../core/ki/ki-umwandlung';
import {
  FRAGE_TYP_LABEL,
  FrageTyp,
  LEKTION_FORMAT_VERSION,
  Lektion,
} from '../../core/models/lektion.model';
import { EinstellungenService } from '../../core/services/einstellungen.service';
import {
  KiFehler,
  KiGeneratorService,
  MAX_BILDER,
  WARNUNG_AB_FRAGEN,
  quellenAus,
} from '../../core/services/ki-generator.service';
import { LektionService } from '../../core/services/lektion.service';
import {
  Material,
  MaterialService,
  PdfDokument,
  parseSeitenbereich,
  seitenbereichText,
} from '../../core/services/material.service';
import { verkleinereBild } from '../../core/util/datei';

type Weg = 'auswahl' | 'ki' | 'import' | 'leer';

interface PdfEintrag {
  art: 'pdf';
  id: string;
  dok: PdfDokument;
  vorschau: WritableSignal<(string | null)[]>;
  auswahl: WritableSignal<Set<number>>;
  bereich: WritableSignal<string>;
  bereichFehler: WritableSignal<string | null>;
  /** true, sobald der Eintrag entfernt wurde (Vorschau-Rendering stoppen). */
  entfernt: boolean;
}
interface FotoEintrag {
  art: 'foto';
  id: string;
  name: string;
  dataUrl: string;
}
interface TextEintrag {
  art: 'text';
  id: string;
  titel: string;
  text: string;
}
type Eintrag = PdfEintrag | FotoEintrag | TextEintrag;

const SCHRITTE = [
  'Grunddaten',
  'Material',
  'Lernziele',
  'Optionen',
  'Erstellen',
  'Vorschau',
] as const;

/**
 * Assistent für neue Lektionen (Route /neu): aus Material mit Claude, per
 * JSON-Import oder als leere Lektion. Material bleibt nur im Speicher.
 */
@Component({
  selector: 'app-material-assistent',
  imports: [RouterLink, DecimalPipe],
  templateUrl: './material-assistent.html',
  styleUrl: './material-assistent.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'vorDemVerlassen($event)' },
})
export class MaterialAssistent implements OnDestroy {
  private readonly router = inject(Router);
  private readonly lektionService = inject(LektionService);
  private readonly materialService = inject(MaterialService);
  private readonly einstellungen = inject(EinstellungenService);
  protected readonly ki = inject(KiGeneratorService);

  protected readonly schritte = SCHRITTE;
  protected readonly fragetypenAlle = FRAGE_TYPEN;
  protected readonly typLabel = FRAGE_TYP_LABEL;
  protected readonly maxBilder = MAX_BILDER;

  protected readonly weg = signal<Weg>('auswahl');
  protected readonly schritt = signal(0);
  protected readonly faecher = computed(() => this.lektionService.faecher().map((f) => f.fach));
  protected readonly hatApiSchluessel = this.einstellungen.hatApiSchluessel;

  // --- Grunddaten ---
  protected readonly fach = signal('');
  protected readonly titel = signal('');
  protected readonly klasse = signal('');
  protected readonly pruefungsdatum = signal('');
  protected readonly hinweiseText = signal('');
  protected readonly taschenrechner = signal(false);

  // --- Material ---
  protected readonly eintraege = signal<Eintrag[]>([]);
  protected readonly materialMeldung = signal<string | null>(null);
  protected readonly ladeMaterial = signal(false);
  protected readonly neuerText = signal('');
  protected readonly neuerTextTitel = signal('');

  // --- Lernziele & Optionen ---
  protected readonly lernzieleText = signal('');
  protected readonly lernzieleImMaterial = signal(false);
  protected readonly fragenProLernziel = signal(12);
  protected readonly niveau = signal('');
  protected readonly fragetypen = signal<Set<FrageTyp>>(new Set(FRAGE_TYPEN));

  // --- Erstellen ---
  protected readonly fortschrittProzent = computed(() => {
    const a = this.ki.fortschritt().anteil;
    return a === null ? null : Math.round(a * 100);
  });
  protected readonly kiFehler = signal<string | null>(null);
  protected readonly kopiert = signal(false);
  protected readonly antwortText = signal('');
  protected readonly antwortFehler = signal<string | null>(null);

  // --- Vorschau / Speichern ---
  protected readonly ergebnis = signal<UmwandlungsErgebnis | null>(null);
  protected readonly speichert = signal(false);
  protected readonly speicherFehler = signal<string | null>(null);

  // --- Import ---
  protected readonly importFehler = signal<string[]>([]);
  protected readonly importLektion = signal<Lektion | null>(null);
  protected readonly importModus = signal<'ersetzen' | 'kopie'>('kopie');
  protected readonly importExistiert = computed(() => {
    const l = this.importLektion();
    return !!l && !!this.lektionService.lektion(l.id);
  });

  // --- Leer ---
  protected readonly leerFehler = signal<string | null>(null);

  private naechsteId = 1;

  protected readonly lernziele = computed(() =>
    this.lernzieleText()
      .split('\n')
      .map((z) => z.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
      .filter(Boolean),
  );

  protected readonly anzahlBilder = computed(() =>
    KiGeneratorService.anzahlBilder(this.material()),
  );

  /** Erwartete Anzahl Fragen; null, wenn die Lernziele erst im Material stehen. */
  protected readonly fragenGesamt = computed(() =>
    this.lernziele().length ? this.lernziele().length * this.fragenProLernziel() : null,
  );
  protected readonly zuVieleFragen = computed(() => (this.fragenGesamt() ?? 0) > WARNUNG_AB_FRAGEN);

  /**
   * Gibt es etwas, das beim Verlassen verloren ginge? Eine laufende (bezahlte)
   * Erstellung, eingelesenes Material oder ein noch nicht gespeichertes Ergebnis.
   */
  private readonly hatUngesichertes = computed(
    () => this.ki.laeuft() || this.eintraege().length > 0 || !!this.ergebnis()?.lektion,
  );
  /** Wird direkt vor dem Wechsel zur gespeicherten Lektion gesetzt. */
  private verlassenErlaubt = false;

  protected readonly material = computed<Material[]>(() =>
    this.eintraege()
      .map((e): Material | null => {
        if (e.art === 'pdf') {
          const seiten = [...e.auswahl()].sort((a, b) => a - b);
          return seiten.length ? { art: 'pdf', id: e.id, dok: e.dok, seiten } : null;
        }
        return e;
      })
      .filter((m): m is Material => m !== null),
  );

  protected readonly auftrag = computed<KiAuftrag>(() => ({
    fach: this.fach().trim(),
    titel: this.titel().trim(),
    klasse: this.klasse().trim() || undefined,
    pruefungsdatum: this.pruefungsdatum() || undefined,
    hinweise: this.hinweise(),
    taschenrechner: this.taschenrechner(),
    niveau: this.niveau().trim(),
    fragenProLernziel: this.fragenProLernziel(),
    fragetypen: FRAGE_TYPEN.filter((t) => this.fragetypen().has(t)),
    lernziele: this.lernziele(),
    lernzieleImMaterial: this.lernzieleImMaterial(),
    materialListe: this.material().map((m) =>
      m.art === 'pdf'
        ? `PDF «${m.dok.name}»: PDF-Seiten ${seitenbereichText(m.seiten)}`
        : m.art === 'foto'
          ? `Foto «${m.name}»`
          : `Text «${m.titel || 'eingefügter Text'}»`,
    ),
  }));

  /** Freie Hinweise + Taschenrechner-Angabe. */
  private hinweise(): string[] {
    const frei = this.hinweiseText()
      .split('\n')
      .map((z) => z.trim())
      .filter(Boolean);
    return [
      ...frei,
      this.taschenrechner() ? 'Taschenrechner erlaubt' : 'Kein Taschenrechner erlaubt',
    ];
  }

  /** Fehlermeldung, warum der aktuelle Schritt noch nicht weitergehen kann. */
  protected readonly schrittFehler = computed<string | null>(() => {
    switch (this.schritt()) {
      case 0:
        return this.fach().trim() ? null : 'Gib ein Fach an.';
      case 1:
        if (this.anzahlBilder() > MAX_BILDER)
          return `Höchstens ${MAX_BILDER} Bilder (PDF-Seiten + Fotos) — jetzt ${this.anzahlBilder()}.`;
        return this.material().length
          ? null
          : 'Füge Material hinzu und wähle bei PDFs die Seiten aus.';
      case 2:
        return this.lernziele().length || this.lernzieleImMaterial()
          ? null
          : 'Gib Lernziele ein oder bestätige, dass sie im Material stehen.';
      case 3:
        if (this.fragetypen().size === 0) return 'Wähle mindestens einen Fragetyp.';
        return this.fragenProLernziel() >= 4 && this.fragenProLernziel() <= 25
          ? null
          : 'Fragen pro Lernziel: 4 bis 25.';
      default:
        return null;
    }
  });

  // ===================== Verlassen verhindern =====================

  protected vorDemVerlassen(ev: BeforeUnloadEvent): void {
    if (this.verlassenErlaubt || !this.hatUngesichertes()) return;
    ev.preventDefault();
    ev.returnValue = '';
  }

  /** Für den CanDeactivate-Guard der Route: fragt nach, bevor Material oder Ergebnis verloren gehen. */
  darfVerlassen(): boolean {
    if (this.verlassenErlaubt || !this.hatUngesichertes()) return true;
    return window.confirm(
      this.ki.laeuft()
        ? 'Claude erstellt gerade deine Lektion. Wenn du die Seite verlässt, wird die Erstellung abgebrochen — die bisherigen Kosten fallen trotzdem an. Trotzdem verlassen?'
        : 'Dein Material und die noch nicht gespeicherte Lektion gehen verloren, wenn du die Seite verlässt. Trotzdem verlassen?',
    );
  }

  ngOnDestroy(): void {
    this.ki.abbrechen();
    this.ki.zuruecksetzen();
    for (const e of this.eintraege()) if (e.art === 'pdf') this.schliessePdf(e);
  }

  // ===================== Navigation =====================

  protected waehle(weg: Weg): void {
    this.weg.set(weg);
    this.schritt.set(0);
    this.fokusAuf(weg === 'ki' ? 'schritt-titel' : 'weg-titel');
  }

  protected zurueckZurAuswahl(): void {
    if (this.ki.laeuft()) return;
    this.weg.set('auswahl');
    this.fokusAuf('seiten-titel');
  }

  protected weiter(): void {
    if (this.schrittFehler()) return;
    this.schritt.update((s) => Math.min(s + 1, SCHRITTE.length - 1));
    this.fokusOben();
  }

  protected zurueck(): void {
    if (this.ki.laeuft()) return;
    this.schritt.update((s) => Math.max(s - 1, 0));
    this.fokusOben();
  }

  protected geheZu(i: number): void {
    if (this.ki.laeuft() || i >= this.schritt()) return;
    this.schritt.set(i);
    this.fokusOben();
  }

  private fokusOben(): void {
    this.fokusAuf('schritt-titel');
  }

  /** Fokus nach dem Rendern auf eine Überschrift setzen (Tastatur, Screenreader). */
  private fokusAuf(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus());
  }

  // ===================== Material =====================

  protected async pdfHinzufuegen(input: HTMLInputElement): Promise<void> {
    const dateien = [...(input.files ?? [])];
    input.value = '';
    if (!dateien.length) return;
    this.materialMeldung.set(null);
    this.ladeMaterial.set(true);
    try {
      for (const datei of dateien) {
        const dok = await this.materialService.ladePdf(datei);
        const eintrag: PdfEintrag = {
          art: 'pdf',
          id: this.neueId(),
          dok,
          vorschau: signal<(string | null)[]>(Array(dok.seitenzahl).fill(null)),
          auswahl: signal(new Set<number>()),
          bereich: signal(''),
          bereichFehler: signal<string | null>(null),
          entfernt: false,
        };
        this.eintraege.update((l) => [...l, eintrag]);
        void this.rendereVorschau(eintrag);
      }
    } catch (e) {
      this.materialMeldung.set((e as Error).message);
    } finally {
      this.ladeMaterial.set(false);
    }
  }

  private async rendereVorschau(e: PdfEintrag): Promise<void> {
    for (let s = 1; s <= e.dok.seitenzahl; s++) {
      if (e.entfernt) return;
      try {
        const url = await this.materialService.vorschau(e.dok, s);
        e.vorschau.update((v) => {
          const n = [...v];
          n[s - 1] = url;
          return n;
        });
      } catch {
        // Vorschau ist nur Hilfe; Fehler einzelner Seiten ignorieren.
      }
    }
  }

  protected async fotosHinzufuegen(input: HTMLInputElement): Promise<void> {
    const dateien = [...(input.files ?? [])];
    input.value = '';
    if (!dateien.length) return;
    this.materialMeldung.set(null);
    this.ladeMaterial.set(true);
    try {
      for (const datei of dateien) {
        const dataUrl = await verkleinereBild(datei, 1600, 0.8);
        this.eintraege.update((l) => [
          ...l,
          { art: 'foto', id: this.neueId(), name: datei.name || 'Foto', dataUrl },
        ]);
      }
    } catch {
      this.materialMeldung.set('Ein Bild konnte nicht gelesen werden (Format nicht unterstützt?).');
    } finally {
      this.ladeMaterial.set(false);
    }
  }

  protected textHinzufuegen(): void {
    const text = this.neuerText().trim();
    if (!text) return;
    this.eintraege.update((l) => [
      ...l,
      { art: 'text', id: this.neueId(), titel: this.neuerTextTitel().trim(), text },
    ]);
    this.neuerText.set('');
    this.neuerTextTitel.set('');
  }

  protected entfernen(e: Eintrag): void {
    if (e.art === 'pdf') this.schliessePdf(e);
    this.eintraege.update((l) => l.filter((x) => x.id !== e.id));
  }

  private schliessePdf(e: PdfEintrag): void {
    e.entfernt = true;
    void this.materialService.schliesse(e.dok);
  }

  protected seiteUmschalten(e: PdfEintrag, seite: number): void {
    e.auswahl.update((s) => {
      const n = new Set(s);
      if (n.has(seite)) n.delete(seite);
      else n.add(seite);
      return n;
    });
  }

  protected alleSeiten(e: PdfEintrag, alle: boolean): void {
    e.auswahl.set(
      alle ? new Set(Array.from({ length: e.dok.seitenzahl }, (_, i) => i + 1)) : new Set(),
    );
    e.bereichFehler.set(null);
  }

  protected bereichUebernehmen(e: PdfEintrag): void {
    const { seiten, fehler } = parseSeitenbereich(e.bereich(), e.dok.seitenzahl);
    e.bereichFehler.set(fehler);
    if (!fehler) e.auswahl.set(new Set(seiten));
  }

  protected auswahlText(e: PdfEintrag): string {
    const s = [...e.auswahl()];
    return s.length ? `${s.length} ausgewählt: ${seitenbereichText(s)}` : 'Keine Seite ausgewählt';
  }

  protected seitenNummern(e: PdfEintrag): number[] {
    return Array.from({ length: e.dok.seitenzahl }, (_, i) => i + 1);
  }

  private neueId(): string {
    return `m${this.naechsteId++}`;
  }

  // ===================== Optionen =====================

  protected typUmschalten(t: FrageTyp): void {
    this.fragetypen.update((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  }

  protected setzeFragenProLernziel(wert: string): void {
    const n = Math.round(Number(wert));
    if (Number.isFinite(n)) this.fragenProLernziel.set(Math.min(25, Math.max(4, n)));
  }

  // ===================== Erstellen =====================

  protected async mitClaudeErstellen(): Promise<void> {
    this.kiFehler.set(null);
    try {
      const ergebnis = await this.ki.erstelle(this.auftrag(), this.material());
      this.zeigeErgebnis(ergebnis);
    } catch (e) {
      this.kiFehler.set(e instanceof KiFehler ? e.message : (e as Error).message);
    }
  }

  protected async promptKopieren(): Promise<void> {
    try {
      const texte = this.material().flatMap((m) => (m.art === 'text' ? [m] : []));
      await navigator.clipboard.writeText(kopierPrompt(this.auftrag(), texte));
      this.kopiert.set(true);
      setTimeout(() => this.kopiert.set(false), 4000);
    } catch {
      this.antwortFehler.set(
        'Kopieren nicht möglich. Erlaube den Zugriff auf die Zwischenablage oder verwende einen anderen Browser.',
      );
    }
  }

  protected antwortUebernehmen(): void {
    this.antwortFehler.set(null);
    let daten: unknown;
    try {
      daten = parseKiJson(this.antwortText());
    } catch (e) {
      this.antwortFehler.set((e as Error).message);
      return;
    }
    const a = this.auftrag();
    const ergebnis = wandleKiAntwort(daten, {
      idFuer: (t) => this.lektionService.freieId(t),
      fach: a.fach,
      titel: a.titel,
      klasse: a.klasse,
      pruefungsdatum: a.pruefungsdatum,
      hinweise: a.hinweise,
      quellen: quellenAus(this.material()),
      herkunft: 'ki',
    });
    if (!ergebnis.lektion) {
      this.antwortFehler.set(ergebnis.fehler.join(' '));
      return;
    }
    this.zeigeErgebnis(ergebnis);
  }

  private zeigeErgebnis(ergebnis: UmwandlungsErgebnis): void {
    this.ergebnis.set(ergebnis);
    this.speicherFehler.set(null);
    this.schritt.set(SCHRITTE.length - 1);
    this.fokusOben();
  }

  protected readonly lernzielUebersicht = computed(() => {
    const l = this.ergebnis()?.lektion;
    if (!l) return [];
    return l.lernziele.map((lz) => ({
      lz,
      anzahl: l.fragen.filter((f) => f.lernzielId === lz.id).length,
    }));
  });

  protected async speichern(editor: boolean): Promise<void> {
    const l = this.ergebnis()?.lektion;
    if (!l || this.ergebnis()?.fehler.length) return;
    await this.speichereUndOeffne(l, editor);
  }

  private async speichereUndOeffne(l: Lektion, editor: boolean): Promise<void> {
    this.speichert.set(true);
    this.speicherFehler.set(null);
    try {
      await this.lektionService.speichern(l);
      this.verlassenErlaubt = true;
      const ok = await this.router.navigate(
        editor ? ['/lektion', l.id, 'bearbeiten'] : ['/lektion', l.id],
      );
      if (!ok) this.verlassenErlaubt = false;
    } catch {
      this.verlassenErlaubt = false;
      this.speicherFehler.set(
        'Speichern fehlgeschlagen. Ist der Speicher des Browsers voll oder blockiert?',
      );
    } finally {
      this.speichert.set(false);
    }
  }

  // ===================== Import =====================

  protected async importDatei(input: HTMLInputElement): Promise<void> {
    const datei = input.files?.[0];
    input.value = '';
    this.importFehler.set([]);
    this.importLektion.set(null);
    if (!datei) return;
    let daten: unknown;
    try {
      daten = JSON.parse(await datei.text());
    } catch {
      this.importFehler.set(['Die Datei ist keine gültige JSON-Datei.']);
      return;
    }
    const fehler = validiereLektion(daten);
    if (fehler.length) {
      this.importFehler.set(fehler);
      return;
    }
    this.importLektion.set(ergaenzeLektion(daten as Lektion));
    this.importModus.set('kopie');
  }

  protected async importSpeichern(): Promise<void> {
    const l = this.importLektion();
    if (!l) return;
    const id =
      this.importExistiert() && this.importModus() === 'kopie'
        ? this.lektionService.freieId(l.titel)
        : l.id;
    const titel = id !== l.id ? `${l.titel} (Kopie)` : l.titel;
    await this.speichereUndOeffne({ ...l, id, titel, herkunft: 'import' }, false);
  }

  // ===================== Leere Lektion =====================

  protected async leerAnlegen(): Promise<void> {
    const fach = this.fach().trim();
    const titel = this.titel().trim();
    if (!fach || !titel) {
      this.leerFehler.set('Gib Fach und Titel an.');
      return;
    }
    this.leerFehler.set(null);
    const l: Lektion = {
      id: this.lektionService.freieId(titel),
      format: LEKTION_FORMAT_VERSION,
      version: 1,
      fach,
      titel,
      beschreibung: '',
      quellen: [],
      lernziele: [{ id: 'lz-1', thema: 'Allgemein', text: 'Neues Lernziel', zusammenfassung: '' }],
      fragen: [],
      herkunft: 'manuell',
      erstelltAm: new Date().toISOString(),
    };
    await this.speichereUndOeffne(l, true);
  }

  // ===================== Hilfen fürs Template =====================

  protected wert(ev: Event): string {
    return (ev.target as HTMLInputElement).value;
  }

  protected anzahl(n: number, einzahl: string, mehrzahl: string): string {
    return `${n} ${n === 1 ? einzahl : mehrzahl}`;
  }

  protected checked(ev: Event): boolean {
    return (ev.target as HTMLInputElement).checked;
  }
}
