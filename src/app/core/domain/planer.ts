import {
  Bewertung,
  FrageFortschritt,
  MAX_FACH,
  fortschrittSchluessel,
  neuerFortschritt,
} from '../models/fortschritt.model';
import { Frage, Lektion, Lernziel } from '../models/lektion.model';
import { PruefungsStil } from '../models/rueckmeldung.model';

/**
 * Wiederholungsplaner (Leitner). Nach einer Antwort wandert die Frage in ein
 * Fach; das Fach bestimmt, wann sie wieder fällig ist.
 */

const TAG_MS = 24 * 60 * 60 * 1000;

/** Abstand bis zur nächsten Wiederholung je Fach (Index = Fach). */
export const INTERVALL_MS: readonly number[] = [0, 0, 1 * TAG_MS, 3 * TAG_MS, 7 * TAG_MS, 14 * TAG_MS];

export type Zufall = () => number;

/** Fisher-Yates mit austauschbarer Zufallsquelle (für Tests deterministisch). */
export function mische<T>(liste: readonly T[], zufall: Zufall = Math.random): T[] {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(zufall() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Verbucht eine Antwort. Steht eine Prüfung an, wird keine Wiederholung nach
 * dem Vortag der Prüfung angesetzt — so ist am Vortag alles noch einmal dran.
 */
export function verbucheAntwort(
  alt: FrageFortschritt,
  bewertung: Bewertung,
  jetzt: Date,
  pruefungsdatum?: string,
): FrageFortschritt {
  let fach: number;
  if (bewertung === 'richtig') {
    fach = alt.fach === 0 ? 2 : Math.min(MAX_FACH, alt.fach + 1);
  } else if (bewertung === 'teilweise') {
    fach = Math.max(1, alt.fach);
  } else {
    fach = 1;
  }

  let faellig = jetzt.getTime() + INTERVALL_MS[fach];
  if (pruefungsdatum) {
    const vortag = new Date(`${pruefungsdatum}T00:00:00`).getTime() - TAG_MS;
    if (vortag > jetzt.getTime()) faellig = Math.min(faellig, vortag);
  }

  return {
    ...alt,
    fach,
    richtig: alt.richtig + (bewertung === 'richtig' ? 1 : 0),
    falsch: alt.falsch + (bewertung === 'falsch' ? 1 : 0),
    zuletzt: jetzt.toISOString(),
    faelligAb: new Date(faellig).toISOString(),
    verlauf: [...alt.verlauf, bewertung].slice(-5),
  };
}

export function istFaellig(f: FrageFortschritt, jetzt: Date): boolean {
  if (f.fach === 0) return true;
  return !f.faelligAb || new Date(f.faelligAb).getTime() <= jetzt.getTime();
}

export type FortschrittMap = ReadonlyMap<string, FrageFortschritt>;

export function fortschrittVon(lektionId: string, frage: Frage, map: FortschrittMap): FrageFortschritt {
  return map.get(fortschrittSchluessel(lektionId, frage.id)) ?? neuerFortschritt(lektionId, frage.id);
}

export interface AuswahlOptionen {
  anzahl: number;
  /** Nur Fragen dieses Lernziels. */
  lernzielId?: string;
  /** Nur Fragen, die zuletzt falsch oder teilweise beantwortet wurden. */
  nurFehler?: boolean;
  jetzt: Date;
  zufall?: Zufall;
}

/**
 * Wählt die nächsten Fragen für eine Lernrunde. Reihenfolge der Dringlichkeit:
 * 1. fällig und zuletzt falsch (Fach 1)
 * 2. neue Fragen — leichte zuerst
 * 3. übrige fällige — tiefstes Fach zuerst
 * 4. falls noch Platz: nicht fällige, tiefstes Fach und am längsten her zuerst
 * Innerhalb einer Stufe werden die Lernziele abwechselnd bedient.
 */
export function waehleFragen(lektion: Lektion, map: FortschrittMap, opt: AuswahlOptionen): Frage[] {
  const zufall = opt.zufall ?? Math.random;
  let kandidaten = lektion.fragen;
  if (opt.lernzielId) kandidaten = kandidaten.filter((f) => f.lernzielId === opt.lernzielId);
  if (opt.nurFehler) {
    kandidaten = kandidaten.filter((f) => {
      const letzte = fortschrittVon(lektion.id, f, map).verlauf.at(-1);
      return letzte === 'falsch' || letzte === 'teilweise';
    });
  }

  const mitFs = kandidaten.map((frage) => ({ frage, fs: fortschrittVon(lektion.id, frage, map) }));
  const stufe = (x: { fs: FrageFortschritt }): number => {
    if (x.fs.fach === 0) return 2;
    if (!istFaellig(x.fs, opt.jetzt)) return 4;
    return x.fs.fach === 1 ? 1 : 3;
  };

  const ergebnis: Frage[] = [];
  for (const s of [1, 2, 3, 4]) {
    if (ergebnis.length >= opt.anzahl) break;
    let gruppe = mische(
      mitFs.filter((x) => stufe(x) === s),
      zufall,
    );
    if (s === 2) gruppe = gruppe.sort((a, b) => a.frage.schwierigkeit - b.frage.schwierigkeit);
    if (s === 3) gruppe = gruppe.sort((a, b) => a.fs.fach - b.fs.fach);
    if (s === 4) {
      gruppe = gruppe.sort(
        (a, b) =>
          a.fs.fach - b.fs.fach ||
          new Date(a.fs.zuletzt ?? 0).getTime() - new Date(b.fs.zuletzt ?? 0).getTime(),
      );
    }
    const verteilt = reissverschluss(gruppe.map((x) => x.frage));
    ergebnis.push(...verteilt.slice(0, opt.anzahl - ergebnis.length));
  }
  return ergebnis;
}

/** Verteilt die Fragen so, dass aufeinanderfolgende möglichst andere Lernziele haben. */
function reissverschluss(fragen: Frage[]): Frage[] {
  const nachLz = new Map<string, Frage[]>();
  for (const f of fragen) {
    const l = nachLz.get(f.lernzielId) ?? [];
    l.push(f);
    nachLz.set(f.lernzielId, l);
  }
  const schlangen = [...nachLz.values()];
  const out: Frage[] = [];
  while (out.length < fragen.length) {
    for (const s of schlangen) {
      const f = s.shift();
      if (f) out.push(f);
    }
  }
  return out;
}

/**
 * Gewicht einer Frage für den Stil der Lehrperson: bevorzugter Typ ×4; die
 * Schwierigkeit neigt sich zum Ziel, Ziel 2 = keine Gewichtung (wie ohne Stil).
 * Faktor 3^((Schwierigkeit − 2) · (Ziel − 2)): Ziel 3 → Schwierigkeit 1/2/3
 * zählen 1/3, 1, 3; Ziel 1 umgekehrt; Zwischenwerte stetig. Immer positiv,
 * damit auch leichte Fragen drankommen können.
 */
function stilGewicht(f: Frage, stil: PruefungsStil): number {
  const typ = !stil.bevorzugteTypen.length || stil.bevorzugteTypen.includes(f.typ) ? 4 : 1;
  return typ * 3 ** ((f.schwierigkeit - 2) * (stil.schwierigkeitZiel - 2));
}

/**
 * Gewichtete Zufallsreihenfolge (Efraimidis–Spirakis): Schlüssel u^(1/w),
 * absteigend. Schwere Gewichte landen öfter vorne, ohne dass leichte nie drankommen.
 */
function gewichtetMischen(fragen: readonly Frage[], stil: PruefungsStil, zufall: Zufall): Frage[] {
  return fragen
    .map((f) => ({ f, schluessel: zufall() ** (1 / stilGewicht(f, stil)) }))
    .sort((a, b) => b.schluessel - a.schluessel)
    .map((x) => x.f);
}

/**
 * Stellt eine Probeprüfung zusammen: alle Lernziele werden abwechselnd bedient,
 * damit die Prüfung den ganzen Stoff abdeckt. Mit `stil` (Profil der
 * Lehrperson) werden innerhalb eines Lernziels Fragen bevorzugt, deren Typ an
 * den Prüfungen vorkam und deren Schwierigkeit nahe am Ziel liegt.
 */
export function waehlePruefung(
  lektion: Lektion,
  anzahl: number,
  zufall: Zufall = Math.random,
  stil?: PruefungsStil | null,
): Frage[] {
  const nachLz = lektion.lernziele.map((lz) => {
    const fragen = lektion.fragen.filter((f) => f.lernzielId === lz.id);
    return stil ? gewichtetMischen(fragen, stil, zufall) : mische(fragen, zufall);
  });
  const out: Frage[] = [];
  while (out.length < anzahl && nachLz.some((s) => s.length)) {
    for (const s of nachLz) {
      if (out.length >= anzahl) break;
      const f = s.shift();
      if (f) out.push(f);
    }
  }
  return mische(out, zufall);
}

export type StandStufe = 'neu' | 'am-lernen' | 'fast' | 'sitzt';

export interface LernzielStand {
  lernziel: Lernziel;
  /** 0–1: Durchschnitt Fach/MAX_FACH über alle Fragen des Lernziels. */
  anteil: number;
  stufe: StandStufe;
  anzahlFragen: number;
  neu: number;
  faellig: number;
  /** Fragen, die zuletzt falsch oder teilweise beantwortet wurden. */
  fehler: number;
}

export const STAND_LABEL: Record<StandStufe, string> = {
  neu: 'Noch nicht geübt',
  'am-lernen': 'Am Lernen',
  fast: 'Sitzt fast',
  sitzt: 'Sitzt',
};

export function stufeAusAnteil(anteil: number, neu: number, anzahl: number): StandStufe {
  if (anzahl === 0 || neu === anzahl) return 'neu';
  if (anteil >= 0.8) return 'sitzt';
  if (anteil >= 0.5) return 'fast';
  return 'am-lernen';
}

export function lernzielStaende(lektion: Lektion, map: FortschrittMap, jetzt: Date): LernzielStand[] {
  return lektion.lernziele.map((lz) => {
    const fragen = lektion.fragen.filter((f) => f.lernzielId === lz.id);
    const fs = fragen.map((f) => fortschrittVon(lektion.id, f, map));
    const anteil = fs.length ? fs.reduce((s, x) => s + x.fach / MAX_FACH, 0) / fs.length : 0;
    const neu = fs.filter((x) => x.fach === 0).length;
    return {
      lernziel: lz,
      anteil,
      stufe: stufeAusAnteil(anteil, neu, fs.length),
      anzahlFragen: fs.length,
      neu,
      faellig: fs.filter((x) => x.fach > 0 && istFaellig(x, jetzt)).length,
      fehler: fs.filter((x) => {
        const l = x.verlauf.at(-1);
        return l === 'falsch' || l === 'teilweise';
      }).length,
    };
  });
}

/** Gesamtstand einer Lektion (0–1), gewichtet nach Anzahl Fragen. */
export function lektionAnteil(lektion: Lektion, map: FortschrittMap): number {
  if (!lektion.fragen.length) return 0;
  const summe = lektion.fragen.reduce((s, f) => s + fortschrittVon(lektion.id, f, map).fach / MAX_FACH, 0);
  return summe / lektion.fragen.length;
}
