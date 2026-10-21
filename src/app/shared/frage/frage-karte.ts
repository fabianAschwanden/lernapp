import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output, signal, untracked } from '@angular/core';

import { Antwort, Pruefergebnis, loesungAlsText } from '../../core/domain/antwort-pruefung';
import { mische } from '../../core/domain/planer';
import { Bewertung } from '../../core/models/fortschritt.model';
import { FRAGE_TYP_LABEL, Frage, FrageTyp } from '../../core/models/lektion.model';
import { MdPipe } from '../md.pipe';

export type FrageModus = 'ueben' | 'pruefung';

/** Eingaben der Person zur aktuellen Frage — je nach Fragetyp ist ein Teil davon relevant. */
interface Zustand {
  einfach: number | null;
  mehr: number[];
  wf: boolean | null;
  zuordnung: Record<number, string>;
  reihenfolge: string[];
  /** Zahl, Kurzantwort und eigener Text bei offenen Fragen. */
  eingabe: string;
  tipp: boolean;
  /** Offene Frage: Musterlösung aufgedeckt. */
  loesung: boolean;
  selbst: Bewertung | null;
}

const SCHWIERIGKEIT_LABEL: Record<1 | 2 | 3, string> = { 1: 'Grundwissen', 2: 'Anwenden', 3: 'Transfer' };
const BUCHSTABEN = 'ABCDEFGHIJKLMNOP';

let naechsteId = 0;

/** Gemischte Anzeigereihenfolgen pro Frage, z. B. für einen Prüfungsdurchlauf. */
export type Mischungen = Map<Frage, readonly unknown[]>;

/**
 * «Richtig.»/«Falsch.» am Anfang einer Erklärung doppelt den Rückmeldungskopf
 * («✓ Richtig! Richtig. …») bzw. widerspricht ihm scheinbar («✗ Leider falsch —
 * Richtig. …»). Bei Wahr-oder-falsch-Fragen ist die Aussage gemeint: das sagt
 * die Erklärung dann ausdrücklich. Sonst fällt das Wort weg.
 */
export function ohneUrteil(erklaerung: string, typ: FrageTyp): string {
  return erklaerung.replace(/^\s*(Richtig|Falsch)\s*[.!]\s+(?=\S)/, (_, wort: string) =>
    typ === 'wahrfalsch' ? (wort === 'Richtig' ? 'Die Aussage stimmt. ' : 'Die Aussage stimmt nicht. ') : '',
  );
}

/** Mischt so, dass die Reihenfolge nie schon stimmt (sonst wäre die Aufgabe geschenkt). */
function mischeFalsch(elemente: readonly string[]): string[] {
  if (elemente.length < 2) return [...elemente];
  for (let i = 0; i < 25; i++) {
    const m = mische(elemente);
    if (m.some((e, j) => e !== elemente[j])) return m;
  }
  return [...elemente.slice(1), elemente[0]];
}

/**
 * Rendert jede Frage des Lektionsmodells und liefert die Antwort der Person.
 *
 * - Modus `ueben`: «Prüfen» (oder Enter) meldet die Antwort; mit `ergebnis`
 *   erscheint die Rückmeldung und die Eingaben werden gesperrt.
 * - Modus `pruefung`: jede Änderung wird sofort gemeldet, keine Rückmeldung.
 *   Offene Fragen melden nur den eigenen Text (`eigenerTextAenderung`); die
 *   Bewertung folgt nach der Abgabe mit `selbstkorrektur`.
 */
@Component({
  selector: 'app-frage-karte',
  imports: [MdPipe],
  templateUrl: './frage-karte.html',
  styleUrl: './frage-karte.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FrageKarte {
  readonly frage = input.required<Frage>();
  readonly modus = input<FrageModus>('ueben');
  /** Startwert, z. B. beim Zurückblättern in der Prüfung. */
  readonly antwort = input<Antwort | null>(null);
  /** Wenn gesetzt: Rückmeldung anzeigen, Eingaben sperren. */
  readonly ergebnis = input<Pruefergebnis | null>(null);
  /** Offene Frage nach der Abgabe: Musterlösung zeigen und selbst bewerten lassen. */
  readonly selbstkorrektur = input(false);
  /** Startwert des eigenen Textes bei offenen Fragen (Prüfung). */
  readonly eigenerText = input('');
  /**
   * Gemischte Reihenfolgen eines Prüfungsdurchlaufs: Mit derselben Map bleiben
   * Optionen und Reihenfolge-Elemente beim Zurückblättern und in der Auswertung
   * gleich; jeder neue Durchlauf bringt eine neue Map und damit neue Mischungen.
   * Ohne Map (Üben) wird jedes Mal neu gemischt.
   */
  readonly mischungen = input<Mischungen | null>(null);

  readonly beantwortet = output<Antwort>();
  /** Offene Frage: der eigene Text hat sich geändert (nur im Prüfungsmodus). */
  readonly eigenerTextAenderung = output<string>();

  protected readonly uid = `fk-${naechsteId++}`;
  protected readonly typLabel = FRAGE_TYP_LABEL;
  protected readonly schwierigkeitLabel = SCHWIERIGKEIT_LABEL;
  protected readonly loesungAlsText = loesungAlsText;

  /** Ansage für Screenreader nach dem Verschieben in Reihenfolge-Fragen. */
  protected readonly ansage = signal('');

  /** Zustand wird bei jedem Wechsel der Frage aus dem Startwert neu aufgebaut. */
  protected readonly zustand = linkedSignal<Frage, Zustand>({
    source: this.frage,
    computation: (f) => untracked(() => this.startZustand(f)),
  });

  protected readonly gesperrt = computed(() => !!this.ergebnis() || this.selbstkorrektur());
  protected readonly ueben = computed(() => this.modus() === 'ueben');

  /** Gemischte Indizes der Antwortoptionen (Einfach-/Mehrfachwahl). */
  private readonly optionenReihenfolge = computed<number[]>(() => {
    const f = this.frage();
    if (f.typ !== 'einfachwahl' && f.typ !== 'mehrfachwahl') return [];
    return this.gemischt(f, () => mische(f.optionen.map((_, i) => i)));
  });

  protected readonly optionen = computed(() => {
    const f = this.frage();
    const z = this.zustand();
    const fertig = !!this.ergebnis();
    if (f.typ !== 'einfachwahl' && f.typ !== 'mehrfachwahl') return [];
    return this.optionenReihenfolge().map((index, pos) => {
      const gewaehlt = f.typ === 'einfachwahl' ? z.einfach === index : z.mehr.includes(index);
      const korrekt = f.typ === 'einfachwahl' ? f.richtig === index : f.richtig.includes(index);
      const buchstabe = BUCHSTABEN[pos] ?? String(pos + 1);
      const r = fertig ? rueckmeldung(gewaehlt, korrekt) : null;
      return {
        index,
        text: f.optionen[index],
        // Nach dem Prüfen ✓/✗ statt Buchstabe, damit richtig/falsch nicht nur an der Farbe hängt
        marke: r?.symbol ?? buchstabe,
        gewaehlt,
        klasse: r?.klasse ?? (gewaehlt ? 'gewaehlt' : ''),
        zusatz: r?.klasse === 'richtig fehlte' ? (f.typ === 'mehrfachwahl' ? 'fehlte' : 'richtige Antwort') : '',
        sr: r?.sr ?? '',
      };
    });
  });

  protected readonly wahrFalsch = computed(() => {
    const f = this.frage();
    const z = this.zustand();
    const fertig = !!this.ergebnis();
    if (f.typ !== 'wahrfalsch') return [];
    return [true, false].map((wert) => {
      const gewaehlt = z.wf === wert;
      const r = fertig ? rueckmeldung(gewaehlt, f.richtig === wert) : null;
      return {
        wert,
        text: wert ? 'Wahr' : 'Falsch',
        gewaehlt,
        klasse: r?.klasse ?? (gewaehlt ? 'gewaehlt' : ''),
        sr: r?.sr ?? '',
      };
    });
  });

  /** Eindeutige Zielwerte für Zuordnen-Fragen, alphabetisch (feste Reihenfolge erleichtert das Finden). */
  protected readonly rechtsWerte = computed<string[]>(() => {
    const f = this.frage();
    if (f.typ !== 'zuordnen') return [];
    return [...new Set(f.paare.map((p) => p.rechts))].sort((a, b) => a.localeCompare(b, 'de-CH'));
  });

  /** Zuordnen: wie viele Felder noch keine Auswahl haben (Hinweis beim gesperrten «Prüfen»). */
  protected readonly offeneZuordnungen = computed(() => {
    const f = this.frage();
    const z = this.zustand();
    return f.typ === 'zuordnen' ? f.paare.filter((_, i) => !z.zuordnung[i]).length : 0;
  });

  protected readonly erklaerung = computed(() => ohneUrteil(this.frage().erklaerung, this.frage().typ));

  protected readonly vollstaendig = computed(() => {
    const f = this.frage();
    const z = this.zustand();
    switch (f.typ) {
      case 'einfachwahl':
        return z.einfach !== null;
      case 'mehrfachwahl':
        return z.mehr.length > 0;
      case 'wahrfalsch':
        return z.wf !== null;
      case 'zuordnen':
        return f.paare.every((_, i) => !!z.zuordnung[i]);
      case 'reihenfolge':
        return true;
      case 'zahl':
      case 'kurzantwort':
        return z.eingabe.trim().length > 0;
      case 'offen':
        return z.selbst !== null;
    }
  });

  protected readonly kopfText = computed(() => {
    const e = this.ergebnis();
    if (!e) return '';
    if (e.bewertung === 'richtig') return 'Richtig!';
    if (e.bewertung === 'teilweise') return `Teilweise richtig (${Math.round(e.anteil * 100)} %)`;
    return 'Leider falsch';
  });

  // ---------- Eingaben ----------

  protected waehleOption(index: number): void {
    if (this.gesperrt()) return;
    const f = this.frage();
    if (f.typ === 'einfachwahl') {
      this.zustand.update((z) => ({ ...z, einfach: index }));
    } else if (f.typ === 'mehrfachwahl') {
      this.zustand.update((z) => ({
        ...z,
        mehr: z.mehr.includes(index) ? z.mehr.filter((i) => i !== index) : [...z.mehr, index].sort((a, b) => a - b),
      }));
    }
    this.meldeImPruefungsmodus();
  }

  protected waehleWahrFalsch(wert: boolean): void {
    if (this.gesperrt()) return;
    this.zustand.update((z) => ({ ...z, wf: wert }));
    this.meldeImPruefungsmodus();
  }

  protected ordneZu(i: number, wert: string): void {
    if (this.gesperrt()) return;
    this.zustand.update((z) => {
      const zuordnung = { ...z.zuordnung };
      if (wert) zuordnung[i] = wert;
      else delete zuordnung[i];
      return { ...z, zuordnung };
    });
    this.meldeImPruefungsmodus();
  }

  protected verschiebe(pos: number, richtung: -1 | 1): void {
    if (this.gesperrt()) return;
    const ziel = pos + richtung;
    const liste = [...this.zustand().reihenfolge];
    if (ziel < 0 || ziel >= liste.length) return;
    [liste[pos], liste[ziel]] = [liste[ziel], liste[pos]];
    this.zustand.update((z) => ({ ...z, reihenfolge: liste }));
    this.ansage.set(`«${liste[ziel]}» ist jetzt an Position ${ziel + 1} von ${liste.length}.`);
    this.meldeImPruefungsmodus();
  }

  protected tippe(wert: string): void {
    if (this.gesperrt()) return;
    this.zustand.update((z) => ({ ...z, eingabe: wert }));
    if (this.frage().typ === 'offen') {
      if (!this.ueben()) this.eigenerTextAenderung.emit(wert);
      return;
    }
    this.meldeImPruefungsmodus();
  }

  protected zeigeTipp(): void {
    this.zustand.update((z) => ({ ...z, tipp: !z.tipp }));
  }

  protected zeigeLoesung(): void {
    this.zustand.update((z) => ({ ...z, loesung: true }));
  }

  protected bewerteSelbst(selbst: Bewertung): void {
    if (this.ergebnis()) return;
    this.zustand.update((z) => ({ ...z, selbst }));
    this.beantwortet.emit({ typ: 'offen', selbst });
  }

  /** Formular-Submit (Klick auf «Prüfen» oder Enter in einem Eingabefeld). */
  protected absenden(ev: Event): void {
    ev.preventDefault();
    if (!this.ueben() || this.gesperrt() || !this.vollstaendig()) return;
    const a = this.aktuelleAntwort();
    if (a) this.beantwortet.emit(a);
  }

  // ---------- intern ----------

  private meldeImPruefungsmodus(): void {
    if (this.ueben()) return;
    const a = this.aktuelleAntwort();
    if (a) this.beantwortet.emit(a);
  }

  private aktuelleAntwort(): Antwort | null {
    const f = this.frage();
    const z = this.zustand();
    switch (f.typ) {
      case 'einfachwahl':
        return z.einfach === null ? null : { typ: 'einfachwahl', wahl: z.einfach };
      case 'mehrfachwahl':
        return { typ: 'mehrfachwahl', wahl: [...z.mehr] };
      case 'wahrfalsch':
        return z.wf === null ? null : { typ: 'wahrfalsch', wert: z.wf };
      case 'zuordnen':
        return { typ: 'zuordnen', zuordnung: { ...z.zuordnung } };
      case 'reihenfolge':
        return { typ: 'reihenfolge', reihenfolge: [...z.reihenfolge] };
      case 'zahl':
        return { typ: 'zahl', eingabe: z.eingabe };
      case 'kurzantwort':
        return { typ: 'kurzantwort', eingabe: z.eingabe };
      case 'offen':
        return z.selbst === null ? null : { typ: 'offen', selbst: z.selbst };
    }
  }

  private gemischt<T>(f: Frage, erzeuge: () => T[]): T[] {
    const speicher = this.mischungen();
    if (!speicher) return erzeuge();
    let m = speicher.get(f) as T[] | undefined;
    if (!m) {
      m = erzeuge();
      speicher.set(f, m);
    }
    return m;
  }

  private startZustand(f: Frage): Zustand {
    const a = this.antwort();
    const z: Zustand = {
      einfach: null,
      mehr: [],
      wf: null,
      zuordnung: {},
      reihenfolge: [],
      eingabe: '',
      tipp: false,
      loesung: false,
      selbst: null,
    };
    if (f.typ === 'reihenfolge') {
      const passt =
        a?.typ === 'reihenfolge' &&
        a.reihenfolge.length === f.elemente.length &&
        f.elemente.every((e) => a.reihenfolge.includes(e));
      z.reihenfolge = passt ? [...a.reihenfolge] : this.gemischt(f, () => mischeFalsch(f.elemente));
    }
    if (f.typ === 'offen') z.eingabe = this.eigenerText();
    if (!a || a.typ !== f.typ) return z;
    switch (a.typ) {
      case 'einfachwahl':
        z.einfach = a.wahl;
        break;
      case 'mehrfachwahl':
        z.mehr = [...a.wahl];
        break;
      case 'wahrfalsch':
        z.wf = a.wert;
        break;
      case 'zuordnen':
        z.zuordnung = { ...a.zuordnung };
        break;
      case 'zahl':
      case 'kurzantwort':
        z.eingabe = a.eingabe;
        break;
      case 'offen':
        z.selbst = a.selbst;
        z.loesung = true;
        break;
    }
    return z;
  }
}

/** Darstellung einer Option nach dem Prüfen: Klasse, sichtbares Symbol und Text für Screenreader. */
function rueckmeldung(gewaehlt: boolean, korrekt: boolean): { klasse: string; symbol: string | null; sr: string } | null {
  if (korrekt && gewaehlt) return { klasse: 'richtig', symbol: '✓', sr: '(richtig gewählt)' };
  if (korrekt) return { klasse: 'richtig fehlte', symbol: '✓', sr: '(richtig, nicht gewählt)' };
  if (gewaehlt) return { klasse: 'falsch', symbol: '✗', sr: '(falsch gewählt)' };
  return null;
}
