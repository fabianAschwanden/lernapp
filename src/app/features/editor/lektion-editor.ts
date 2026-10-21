import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { validiereLektion } from '../../core/domain/lektion-validierung';
import {
  FRAGE_TYP_LABEL,
  Frage,
  FrageTyp,
  Lektion,
  Lernziel,
  ZuordnenFrage,
} from '../../core/models/lektion.model';
import { LektionService } from '../../core/services/lektion.service';
import { verkleinereBild } from '../../core/util/datei';
import { MdPipe } from '../../shared/md.pipe';
import { FrageKarte } from '../../shared/frage/frage-karte';
import {
  bereinige,
  fehlerZiel,
  frageVorlage,
  kurztext,
  lernzielId,
  neueFrageId,
  verschiebe,
} from './editor-hilfen';
import { TextListe } from './text-liste';

type Abschnitt = 'grunddaten' | 'lernziele' | 'fragen';

const TYPEN = Object.keys(FRAGE_TYP_LABEL) as FrageTyp[];

/**
 * Bearbeitet eine Lektion: Grunddaten, Lernziele (Lernzettel) und Fragen.
 * Gearbeitet wird auf einer Arbeitskopie; gespeichert wird erst, wenn die
 * Validierung keine Fehler mehr meldet.
 */
@Component({
  selector: 'app-lektion-editor',
  imports: [RouterLink, MdPipe, TextListe, FrageKarte],
  templateUrl: './lektion-editor.html',
  styleUrl: './lektion-editor.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'vorDemVerlassen($event)' },
})
export class LektionEditor {
  private readonly lektionen = inject(LektionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly id = input.required<string>();

  readonly typen = TYPEN;
  readonly typLabel = FRAGE_TYP_LABEL;
  readonly kurztext = kurztext;
  readonly schwierigkeiten = [
    { wert: 1 as const, label: 'Grundwissen' },
    { wert: 2 as const, label: 'Anwenden' },
    { wert: 3 as const, label: 'Transfer' },
  ];

  /** Arbeitskopie. Änderungen passieren in place, danach wird das Signal mit neuer Referenz gesetzt. */
  readonly entwurf = signal<Lektion | null>(null);
  readonly geaendert = signal(false);
  readonly abschnitt = signal<Abschnitt>('grunddaten');
  readonly meldung = signal<{ text: string; art: 'erfolg' | 'fehler' } | null>(null);
  readonly speichertGerade = signal(false);

  /** Vorschau der Kurzfassung (Grunddaten) sichtbar. */
  readonly vorschauKurzfassung = signal(false);

  /** Lernziele, deren Zusammenfassung als Vorschau gezeigt wird. */
  readonly vorschauLz = signal<ReadonlySet<Lernziel>>(new Set());

  readonly filterLz = signal<string>('');
  readonly gewaehlteFrageId = signal<string | null>(null);
  readonly neuerTyp = signal<FrageTyp>('einfachwahl');
  readonly frageVorschau = signal(false);
  readonly bildFehler = signal<string | null>(null);

  readonly istMitgeliefert = computed(() => this.lektionen.istMitgeliefert(this.id()));
  readonly faecher = computed(() => [...new Set(this.lektionen.lektionen().map((l) => l.fach))]);
  readonly themen = computed(() => [...new Set((this.entwurf()?.lernziele ?? []).map((lz) => lz.thema))]);

  readonly fehler = computed(() => {
    const l = this.entwurf();
    return l ? validiereLektion(bereinige(l)) : [];
  });

  /** Fehlerzahl pro Frage-Index — für die Markierung in der Liste. */
  readonly fehlerProFrage = computed(() => {
    const map = new Map<number, number>();
    for (const m of this.fehler()) {
      const z = fehlerZiel(m);
      if (z?.art === 'frage') map.set(z.index, (map.get(z.index) ?? 0) + 1);
    }
    return map;
  });

  readonly gefilterteFragen = computed(() => {
    const l = this.entwurf();
    if (!l) return [];
    const lz = this.filterLz();
    return l.fragen.map((frage, index) => ({ frage, index })).filter((x) => !lz || x.frage.lernzielId === lz);
  });

  readonly gewaehlteFrage = computed(() => {
    const id = this.gewaehlteFrageId();
    return this.entwurf()?.fragen.find((f) => f.id === id) ?? null;
  });

  readonly gewaehlteFrageFehler = computed(() => {
    const l = this.entwurf();
    const f = this.gewaehlteFrage();
    if (!l || !f) return [];
    const index = l.fragen.indexOf(f);
    return this.fehler().filter((m) => fehlerZiel(m)?.art === 'frage' && fehlerZiel(m)?.index === index);
  });

  /** Kopie für die Vorschau — die FrageKarte bekommt bei jeder Änderung ein neues Objekt. */
  readonly vorschauFrage = computed(() => {
    this.entwurf();
    const f = this.gewaehlteFrage();
    return f ? (bereinige({ ...this.entwurf()!, fragen: [f] }).fragen[0] ?? null) : null;
  });

  /** Werte der rechten Seite bei Zuordnen-Fragen (als Vorschläge). */
  readonly rechtsWerte = computed(() => {
    const f = this.gewaehlteFrage();
    return f?.typ === 'zuordnen' ? [...new Set(f.paare.map((p) => p.rechts).filter((r) => r.trim()))] : [];
  });

  private fragenOriginal = '';
  /** Lernziele, die in dieser Sitzung neu angelegt wurden (ihre id folgt dem Text). */
  private readonly neueLernziele = new WeakSet<Lernziel>();

  constructor() {
    effect(() => {
      const id = this.id();
      const quelle = this.lektionen.lektion(id);
      untracked(() => {
        if (!quelle || this.entwurf()?.id === id) return;
        const kopie = structuredClone(quelle);
        this.entwurf.set(kopie);
        this.fragenOriginal = JSON.stringify(kopie.fragen);
        this.geaendert.set(false);
      });
    });
  }

  // ---------- Allgemein ----------

  /** Nach einer Änderung in place: Signal neu setzen und als ungespeichert markieren. */
  beruehrt(): void {
    this.entwurf.update((l) => (l ? { ...l } : l));
    this.geaendert.set(true);
    this.meldung.set(null);
  }

  text(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  setze<T extends object, K extends keyof T>(ziel: T, feld: K, wert: T[K]): void {
    ziel[feld] = wert;
    this.beruehrt();
  }

  zahlOderUndefined(e: Event): number | undefined {
    const roh = (e.target as HTMLInputElement).value.replace(',', '.').trim();
    if (!roh) return undefined;
    const n = Number(roh);
    return Number.isFinite(n) ? n : undefined;
  }

  /** Zahl aus einem Eingabefeld; leer oder ungültig → NaN (meldet die Validierung). */
  zahl(e: Event): number {
    return this.zahlOderUndefined(e) ?? Number.NaN;
  }

  zahlAnzeige(n: number | undefined): string {
    return n === undefined || Number.isNaN(n) ? '' : String(n);
  }

  vorDemVerlassen(e: BeforeUnloadEvent): void {
    if (this.geaendert()) e.preventDefault();
  }

  /** Für den CanDeactivate-Guard der Route: fragt bei ungespeicherten Änderungen nach. */
  kannVerlassen(): boolean {
    return !this.geaendert() || confirm('Du hast ungespeicherte Änderungen. Trotzdem verlassen?');
  }

  async speichern(): Promise<void> {
    const l = this.entwurf();
    if (!l || this.fehler().length || this.speichertGerade()) return;
    this.speichertGerade.set(true);
    try {
      const sauber = bereinige(l);
      if (JSON.stringify(sauber.fragen) !== this.fragenOriginal) sauber.version = (sauber.version || 0) + 1;
      await this.lektionen.speichern(structuredClone(sauber));
      l.version = sauber.version;
      this.fragenOriginal = JSON.stringify(sauber.fragen);
      this.entwurf.set({ ...l });
      this.geaendert.set(false);
      this.meldung.set({ text: 'Gespeichert.', art: 'erfolg' });
    } catch (e) {
      console.error(e);
      this.meldung.set({ text: 'Speichern fehlgeschlagen. Ist der Speicher des Geräts voll?', art: 'fehler' });
    } finally {
      this.speichertGerade.set(false);
    }
  }

  zeigeFehler(meldung: string): void {
    const z = fehlerZiel(meldung);
    const l = this.entwurf();
    if (!z || !l) return;
    if (z.art === 'frage') {
      const f = l.fragen[z.index];
      if (!f) return;
      this.filterLz.set('');
      this.abschnitt.set('fragen');
      this.waehleFrage(f.id);
    } else {
      this.abschnitt.set('lernziele');
      this.fokussiere(`#lz-${z.index}`);
    }
  }

  private fokussiere(selektor: string): void {
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector<HTMLElement>(selektor);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el?.focus({ preventScroll: true });
    });
  }

  // ---------- Grunddaten ----------

  setzeHinweise(l: Lektion, werte: string[]): void {
    l.hinweise = werte;
    this.beruehrt();
  }

  // ---------- Lernziele ----------

  lernzielHinzufuegen(): void {
    const l = this.entwurf();
    if (!l) return;
    const thema = l.lernziele.at(-1)?.thema ?? '';
    const lz: Lernziel = { id: '', thema, text: '', zusammenfassung: '' };
    lz.id = lernzielId({ text: 'neues Ziel', thema: '' }, new Set(l.lernziele.map((x) => x.id)));
    this.neueLernziele.add(lz);
    l.lernziele.push(lz);
    this.beruehrt();
    this.fokussiere(`#lz-${l.lernziele.length - 1}`);
  }

  /** Neue Lernziele bekommen nach dem Ausfüllen des Textes eine sprechende id. */
  lernzielTextFertig(lz: Lernziel): void {
    const l = this.entwurf();
    if (!l || !this.neueLernziele.has(lz) || !lz.text.trim()) return;
    const belegt = new Set(l.lernziele.filter((x) => x !== lz).map((x) => x.id));
    const neu = lernzielId(lz, belegt);
    if (neu === lz.id) return;
    for (const f of l.fragen) if (f.lernzielId === lz.id) f.lernzielId = neu;
    if (this.filterLz() === lz.id) this.filterLz.set(neu);
    lz.id = neu;
    this.beruehrt();
  }

  lernzielVerschieben(i: number, richtung: -1 | 1): void {
    const l = this.entwurf();
    if (!l) return;
    verschiebe(l.lernziele, i, richtung);
    this.beruehrt();
  }

  fragenZu(lz: Lernziel): number {
    return this.entwurf()?.fragen.filter((f) => f.lernzielId === lz.id).length ?? 0;
  }

  lernzielLoeschen(lz: Lernziel): void {
    const l = this.entwurf();
    if (!l) return;
    const n = this.fragenZu(lz);
    const name = lz.text.trim() || 'ohne Text';
    if (
      n > 0 &&
      !confirm(`Lernziel «${name}» löschen? Die ${n} ${n === 1 ? 'Frage' : 'Fragen'} dazu werden mitgelöscht.`)
    )
      return;
    l.lernziele = l.lernziele.filter((x) => x !== lz);
    l.fragen = l.fragen.filter((f) => f.lernzielId !== lz.id);
    if (this.filterLz() === lz.id) this.filterLz.set('');
    if (!l.fragen.some((f) => f.id === this.gewaehlteFrageId())) this.gewaehlteFrageId.set(null);
    this.beruehrt();
  }

  setzeMerksaetze(lz: Lernziel, werte: string[]): void {
    lz.merksaetze = werte;
    this.beruehrt();
  }

  schalteVorschauLz(lz: Lernziel): void {
    this.vorschauLz.update((s) => {
      const n = new Set(s);
      if (n.has(lz)) n.delete(lz);
      else n.add(lz);
      return n;
    });
  }

  // ---------- Fragen ----------

  waehleFrage(id: string | null): void {
    this.gewaehlteFrageId.set(id);
    this.frageVorschau.set(false);
    this.bildFehler.set(null);
    if (id) this.fokussiere('#frage-formular');
  }

  zurListe(): void {
    const id = this.gewaehlteFrageId();
    this.waehleFrage(null);
    if (id) this.fokussiere(`[data-frage="${id}"]`);
  }

  neueFrage(): void {
    const l = this.entwurf();
    if (!l || !l.lernziele.length) return;
    const id = neueFrageId(new Set(l.fragen.map((f) => f.id)));
    const lz = this.filterLz() || l.lernziele[0].id;
    l.fragen.push(frageVorlage(this.neuerTyp(), id, lz));
    this.beruehrt();
    this.waehleFrage(id);
  }

  duplizieren(f: Frage): void {
    const l = this.entwurf();
    if (!l) return;
    const kopie = structuredClone(f);
    kopie.id = neueFrageId(new Set(l.fragen.map((x) => x.id)));
    l.fragen.splice(l.fragen.indexOf(f) + 1, 0, kopie);
    this.beruehrt();
    this.waehleFrage(kopie.id);
  }

  frageLoeschen(f: Frage): void {
    const l = this.entwurf();
    if (!l || !confirm('Diese Frage löschen?')) return;
    l.fragen = l.fragen.filter((x) => x !== f);
    this.beruehrt();
    this.waehleFrage(null);
  }

  setzeSchwierigkeit(f: Frage, wert: 1 | 2 | 3): void {
    f.schwierigkeit = wert;
    this.beruehrt();
  }

  // Optionen (Einfach-/Mehrfachwahl)

  setzeOption(f: Frage, i: number, wert: string): void {
    if (f.typ !== 'einfachwahl' && f.typ !== 'mehrfachwahl') return;
    f.optionen[i] = wert;
    this.beruehrt();
  }

  optionHinzufuegen(f: Frage): void {
    if (f.typ !== 'einfachwahl' && f.typ !== 'mehrfachwahl') return;
    f.optionen.push('');
    this.beruehrt();
  }

  optionEntfernen(f: Frage, i: number): void {
    if (f.typ === 'einfachwahl') {
      f.optionen.splice(i, 1);
      if (f.richtig === i) f.richtig = 0;
      else if (f.richtig > i) f.richtig--;
    } else if (f.typ === 'mehrfachwahl') {
      f.optionen.splice(i, 1);
      f.richtig = f.richtig.filter((r) => r !== i).map((r) => (r > i ? r - 1 : r));
    }
    this.beruehrt();
  }

  istRichtig(f: Frage, i: number): boolean {
    if (f.typ === 'einfachwahl') return f.richtig === i;
    if (f.typ === 'mehrfachwahl') return f.richtig.includes(i);
    return false;
  }

  markiereRichtig(f: Frage, i: number, an: boolean): void {
    if (f.typ === 'einfachwahl') f.richtig = i;
    else if (f.typ === 'mehrfachwahl')
      f.richtig = an ? [...new Set([...f.richtig, i])].sort((a, b) => a - b) : f.richtig.filter((r) => r !== i);
    this.beruehrt();
  }

  // Paare (Zuordnen)

  setzePaar(f: ZuordnenFrage, i: number, seite: 'links' | 'rechts', wert: string): void {
    f.paare[i] = { ...f.paare[i], [seite]: wert };
    this.beruehrt();
  }

  paarHinzufuegen(f: ZuordnenFrage): void {
    f.paare.push({ links: '', rechts: '' });
    this.beruehrt();
  }

  paarEntfernen(f: ZuordnenFrage, i: number): void {
    f.paare.splice(i, 1);
    this.beruehrt();
  }

  setzeListe(f: Frage, feld: 'elemente' | 'akzeptiert' | 'stichworte', werte: string[]): void {
    (f as unknown as Record<string, string[]>)[feld] = werte;
    this.beruehrt();
  }

  // Bild

  async bildGewaehlt(f: Frage, e: Event): Promise<void> {
    const eingabe = e.target as HTMLInputElement;
    const datei = eingabe.files?.[0];
    eingabe.value = '';
    if (!datei) return;
    this.bildFehler.set(null);
    try {
      const src = await verkleinereBild(datei, 1200);
      f.bild = { src, alt: f.bild?.alt ?? '' };
      this.beruehrt();
    } catch (err) {
      console.error(err);
      this.bildFehler.set('Das Bild konnte nicht gelesen werden. Versuche es mit einem JPG oder PNG.');
    }
  }

  bildEntfernen(f: Frage): void {
    delete f.bild;
    this.beruehrt();
  }

  lernzielText(id: string): string {
    const lz = this.entwurf()?.lernziele.find((x) => x.id === id);
    return lz ? kurztext(lz.text, 60) : 'unbekanntes Lernziel';
  }
}
