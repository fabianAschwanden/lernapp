import { slug } from '../../core/domain/id';
import {
  PASSEND_LABEL,
  STOFFE,
  STOFF_LABEL,
  passungsBefund,
  profilAlsText,
  schwierigkeitInWorten,
  stufe,
  zahl,
} from '../../core/domain/rueckmeldung';
import {
  AUFGABENART_LABEL,
  LehrpersonProfil,
  PruefungsRueckmeldung,
} from '../../core/models/rueckmeldung.model';

/** Anzeige-Hilfen für das Profil eines Fachs (Rückmeldungs- und Profil-Seite). */

export interface Kennzahl {
  name: string;
  wert: string;
}

/** Kennzahlen des Profils als Name/Wert-Paare. Den Notenschnitt nur mit `mitNote`. */
export function kennzahlen(p: LehrpersonProfil, mitNote = false): Kennzahl[] {
  const k: Kennzahl[] = [{ name: 'Prüfungen', wert: String(p.anzahl) }];
  if (p.schwierigkeitMittel !== null)
    k.push({ name: 'Schwierigkeit', wert: grossAnfang(schwierigkeitInWorten(p.schwierigkeitMittel)) });
  if (p.lernzielePassendMittel !== null)
    k.push({
      name: 'Lernziele passten',
      wert: `${PASSEND_LABEL[stufe(p.lernzielePassendMittel)]} (${zahl(p.lernzielePassendMittel)} von 5)`,
    });
  if (p.lernzielTreffer !== null) {
    k.push({
      name: 'Lernziele dran',
      wert: `${Math.round(p.lernzielTreffer * 100)} % der beurteilten Lernziele (${p.lernzieleBeurteilt} von ${p.lernzieleGesamt} beurteilt)`,
    });
  }
  const stoff = STOFFE.filter((s) => p.stoffAbgefragt[s]);
  if (stoff.length)
    k.push({
      name: 'Abgefragter Stoff',
      wert: stoff.map((s) => `${STOFF_LABEL[s]} (${p.stoffAbgefragt[s]}×)`).join(', '),
    });
  const mitZeit = p.rueckmeldungen.filter((r) => r.zeit).length;
  if (mitZeit) k.push({ name: 'Zeit knapp', wert: `bei ${p.zeitKnapp} von ${mitZeit} Prüfungen` });
  if (p.aufgabenarten.length) {
    k.push({
      name: 'Aufgabenarten',
      wert: p.aufgabenarten
        .slice(0, 4)
        .map((a) => `${kurzArt(AUFGABENART_LABEL[a.art])} (${a.anzahl}×)`)
        .join(', '),
    });
  }
  if (mitNote && p.noteMittel !== null)
    k.push({ name: 'Notenschnitt', wert: zahl(p.noteMittel, 2) });
  return k;
}

/** Was die Rückmeldungen für das Lernen bedeuten — kurze Tipps in Du-Form. */
export function tippsFuerDich(p: LehrpersonProfil): string[] {
  const t: string[] = [];
  const kam = (art: string) => p.aufgabenarten.some((a) => a.art === art);
  const m = p.schwierigkeitMittel ?? 0;
  if (m >= 0.5) {
    t.push(
      'Die Prüfungen waren schwerer als das Üben: Übe vor allem Transfer- und Anwendungsfragen und erkläre Zusammenhänge in eigenen Worten.',
    );
  } else if (m <= -0.5) {
    t.push(
      'Die Prüfungen waren leichter als das Üben: Sicheres Grundwissen zu allen Lernzielen reicht meist.',
    );
  }
  const passung = passungsBefund(p);
  if (passung === 'hinaus') {
    t.push('Lerne auch Stoff aus dem Unterricht, der nicht ausdrücklich in den Lernzielen steht.');
  } else if (passung === 'teilweise') {
    t.push(
      'Nicht alle Lernziele kamen dran: Lerne trotzdem alle, aber setze Schwerpunkte bei denen, die bisher drankamen.',
    );
  }
  if (kam('erklaeren') || kam('skizze')) {
    t.push(
      'Schreib Antworten bei Erklärfragen in ganzen Sätzen auf, statt sie nur im Kopf zu beantworten.',
    );
  }
  if (kam('rechnen')) t.push('Rechne die Aufgaben vollständig durch, mit Einheit.');
  if (p.zeitKnapp > 0)
    t.push('Die Zeit war knapp: Mach die Probeprüfung mit Zeitlimit (Einstellungen).');
  t.push(
    'Die Probeprüfung wählt die Fragen nach dem Stil der Lehrperson, und bei der nächsten Lektion in diesem Fach fliessen die Rückmeldungen in die Fragen ein.',
  );
  return t;
}

function grossAnfang(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** «Erklären, begründen, beschreiben (ganze Sätze)» → «Erklären, begründen, beschreiben». */
export function kurzArt(label: string): string {
  return label.replace(/\s*\(.*\)$/, '');
}

/** Inhalt der Datei «Als Datei herunterladen»: Profil als Text plus die Rückmeldungen — ohne Noten. */
export interface ProfilExport {
  art: 'lernapp-rueckmeldungen';
  version: 1;
  fach: string;
  lehrpersonen: string[];
  exportiertAm: string;
  /** profilAlsText(): für die Lektionserstellung. */
  text: string;
  rueckmeldungen: Omit<PruefungsRueckmeldung, 'note'>[];
}

export function profilExport(p: LehrpersonProfil, jetzt = new Date()): ProfilExport {
  return {
    art: 'lernapp-rueckmeldungen',
    version: 1,
    fach: p.fach,
    lehrpersonen: p.lehrpersonen,
    exportiertAm: jetzt.toISOString(),
    text: profilAlsText(p, { mitLehrperson: true }),
    rueckmeldungen: p.rueckmeldungen.map(({ note, ...r }) => r),
  };
}

/** Dateiname des Exports, z. B. `rueckmeldungen-biologie.json`. */
export function exportDateiname(p: LehrpersonProfil): string {
  return `rueckmeldungen-${slug(p.fach) || 'fach'}.json`;
}

/** DOM-id des Abschnitts eines Fachs auf der Profil-Seite. */
export function fachAnker(schluessel: string): string {
  return `fach-${slug(schluessel) || 'x'}`;
}
