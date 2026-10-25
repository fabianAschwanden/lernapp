import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import {
  ABDECKUNG_LABEL,
  PASSEND_LABEL,
  RUECKMELDUNG_GRENZEN,
  SCHWIERIGKEIT_LABEL,
  STOFF_LABEL,
  ZEIT_LABEL,
  abgleichMitLektion,
  neueRueckmeldung,
  profilSchluessel,
} from '../../core/domain/rueckmeldung';
import { parseZahl } from '../../core/domain/text';
import {
  AUFGABENART_LABEL,
  Aufgabenart,
  LernzielAbdeckung,
  PruefungsRueckmeldung,
  PruefungsZeit,
  SchwierigkeitVergleich,
  StoffAbdeckung,
} from '../../core/models/rueckmeldung.model';
import { LektionService } from '../../core/services/lektion.service';
import { RueckmeldungService } from '../../core/services/rueckmeldung.service';
import { tageBis } from '../lektion/lektion-anzeige';
import { tippsFuerDich } from '../rueckmeldungen/profil-anzeige';
import { ProfilKennzahlen } from '../rueckmeldungen/profil-kennzahlen';

const optionen = <T extends string | number>(labels: Record<T, string>, werte: T[]) =>
  werte.map((w) => ({ w, t: labels[w] }));

/** Die drei Kernfragen; ohne Antwort bleibt das Feld leer (keine Vorbelegung). */
type Kernfrage = 'passend' | 'stoff' | 'schwierigkeit';
const KERNFRAGEN: { k: Kernfrage; feld: 'lernzielePassend' | 'stoffAbgefragt' | 'schwierigkeit'; frage: string }[] = [
  { k: 'passend', feld: 'lernzielePassend', frage: 'Wie gut passten die Lernziele?' },
  { k: 'stoff', feld: 'stoffAbgefragt', frage: 'Wurde der ganze Lernstoff abgefragt?' },
  { k: 'schwierigkeit', feld: 'schwierigkeit', frage: 'Wie schwierig war die Prüfung?' },
];
/** Note als Zahl wie 4, 4.5 oder 4,75 (kein «4-5», kein «4+»). */
const NOTE_FORMAT = /^\d+([.,]\d+)?$/;

/**
 * Rückmeldung nach der echten Prüfung: Wie gut passten Lernziele und Lernstoff,
 * was kam dran, wie schwierig war es im Vergleich zur App? Die Rückmeldungen
 * eines Fachs ergeben das Profil der Lehrperson (Probeprüfung, nächste Lektionen).
 */
@Component({
  selector: 'app-rueckmeldung',
  imports: [RouterLink, ProfilKennzahlen],
  templateUrl: './rueckmeldung.html',
  styleUrl: './rueckmeldung.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'vorDemVerlassen($event)' },
})
export class RueckmeldungSeite {
  private readonly lektionen = inject(LektionService);
  private readonly rueckmeldungen = inject(RueckmeldungService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  /** Route-Parameter `:id`. */
  readonly id = input('');

  protected readonly G = RUECKMELDUNG_GRENZEN;
  protected readonly passendOptionen = optionen(PASSEND_LABEL, [1, 2, 3, 4, 5]);
  protected readonly stoffOptionen = optionen(STOFF_LABEL, ['alles', 'meiste', 'teile', 'wenig']);
  protected readonly schwierigkeitOptionen = optionen(SCHWIERIGKEIT_LABEL, [-2, -1, 0, 1, 2]);
  protected readonly zeitOptionen = optionen(ZEIT_LABEL, ['knapp', 'passend', 'reichlich']);
  protected readonly abdeckungOptionen = optionen(ABDECKUNG_LABEL, [
    'ja',
    'teilweise',
    'nein',
    'unklar',
  ]);
  protected readonly artOptionen = optionen(
    AUFGABENART_LABEL,
    Object.keys(AUFGABENART_LABEL) as Aufgabenart[],
  );

  protected readonly lektion = computed(() => this.lektionen.lektion(this.id()));
  protected readonly geladen = this.lektionen.geladen;

  protected readonly entwurf = signal<PruefungsRueckmeldung | null>(null);
  protected readonly noteText = signal('');
  protected readonly geaendert = signal(false);
  protected readonly speichertGerade = signal(false);
  protected readonly meldung = signal<{ text: string; art: 'erfolg' | 'fehler' } | null>(null);
  /**
   * Kernfragen, die beantwortet sind (auch mit «Keine Angabe»). Bei einer neuen
   * Rückmeldung leer: Unbeantwortete Gruppen zeigen keine Wahl und «noch offen».
   */
  protected readonly beantwortet = signal<ReadonlySet<Kernfrage>>(new Set());
  /** Kernfragen ohne Antwort (für «noch offen»). */
  protected readonly offen = computed(() => {
    const r = this.entwurf();
    const b = this.beantwortet();
    return new Set(
      r ? KERNFRAGEN.filter((x) => r[x.feld] === undefined && !b.has(x.k)).map((x) => x.k) : [],
    );
  });

  /** Bereits gespeicherte Rückmeldung zu dieser Lektion. */
  protected readonly gespeichert = computed(() => this.rueckmeldungen.fuerLektion(this.id()));
  protected readonly profil = computed(() => {
    const fach = this.gespeichert()?.fach;
    return fach ? this.rueckmeldungen.profilFuerFach(fach) : null;
  });
  protected readonly tipps = computed(() => {
    const p = this.profil();
    return p ? tippsFuerDich(p) : [];
  });
  /** Vorschläge für das Feld Lehrperson. */
  protected readonly lehrpersonen = computed(() => {
    const l = this.lektion();
    return l ? (this.rueckmeldungen.profilFuerFach(l.fach)?.lehrpersonen ?? []) : [];
  });

  protected readonly noteFehler = computed(() => {
    const t = this.noteText().trim();
    if (!t) return null;
    const n = NOTE_FORMAT.test(t) ? parseZahl(t) : null;
    return n === null || n < 1 || n > 6 ? 'Gib eine Note zwischen 1 und 6 ein, z. B. 4.5.' : null;
  });

  /**
   * Nächste Lektion im selben Fach mit Prüfung in der Zukunft (früheste zuerst),
   * damit die Rückmeldung gleich für die nächste Prüfung wirkt.
   */
  protected readonly naechsteLektion = computed(() => {
    const l = this.lektion();
    if (!l) return null;
    const s = profilSchluessel(l.fach);
    const jetzt = new Date();
    return (
      this.lektionen
        .lektionen()
        .filter(
          (x) =>
            x.id !== l.id &&
            profilSchluessel(x.fach) === s &&
            (tageBis(x.pruefungsdatum, jetzt) ?? 0) > 0,
        )
        .sort((a, b) => (a.pruefungsdatum ?? '').localeCompare(b.pruefungsdatum ?? ''))[0] ?? null
    );
  });

  /** Lernziele der Rückmeldung nach Thema der Lektion gruppiert. */
  protected readonly lernzielGruppen = computed(() => {
    const r = this.entwurf();
    const l = this.lektion();
    if (!r || !l) return [];
    const thema = new Map(l.lernziele.map((lz) => [lz.id, lz.thema || 'Weitere Lernziele']));
    const gruppen = new Map<string, { index: number; text: string; abdeckung: LernzielAbdeckung }[]>();
    r.lernziele.forEach((lz, index) => {
      const t = thema.get(lz.lernzielId) ?? 'Nicht mehr in der Lektion';
      gruppen.set(t, [
        ...(gruppen.get(t) ?? []),
        { index, text: lz.text, abdeckung: lz.abdeckung },
      ]);
    });
    return [...gruppen.entries()].map(([titel, lernziele]) => ({
      titel,
      lernziele,
      unbeurteilt: lernziele.filter((lz) => lz.abdeckung === 'unklar').map((lz) => lz.index),
    }));
  });

  private readonly zusammenfassung = viewChild<ElementRef<HTMLElement>>('zusammenfassung');

  constructor() {
    effect(() => {
      const l = this.lektion();
      untracked(() => {
        if (!l || this.entwurf()?.lektionId === l.id) return;
        const vorhanden = this.rueckmeldungen.fuerLektion(l.id);
        let r: PruefungsRueckmeldung;
        if (vorhanden) {
          r = { ...abgleichMitLektion(vorhanden, l), fach: l.fach };
          // Fach der Lektion geändert (Editor, App-Update): gleich übernehmen, sonst
          // fände das Profil unter dem neuen Fach diese Rückmeldung nicht
          if (vorhanden.fach !== l.fach)
            void this.rueckmeldungen.fachNachziehen(l.id, l.fach).catch((e) => console.error(e));
        } else {
          r = neueRueckmeldung(l);
          const lp = this.rueckmeldungen.profilFuerFach(l.fach)?.lehrpersonen[0];
          if (!r.lehrperson && lp) r.lehrperson = lp;
        }
        this.entwurf.set(r);
        this.beantwortet.set(new Set(vorhanden ? KERNFRAGEN.map((x) => x.k) : []));
        this.noteText.set(r.note !== undefined ? r.note.toLocaleString('de-CH') : '');
        this.geaendert.set(false);
      });
    });
  }

  // ---------- Bearbeiten ----------

  private aendere(f: (r: PruefungsRueckmeldung) => PruefungsRueckmeldung): void {
    const r = this.entwurf();
    if (!r) return;
    this.entwurf.set(f(r));
    this.geaendert.set(true);
    this.meldung.set(null);
  }

  protected text(ev: Event): string {
    return (ev.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  /** Setzt ein optionales Textfeld; leer → Feld entfernen. */
  protected setzeText(
    feld: 'lehrperson' | 'pruefungsdatum' | 'ausserhalb' | 'tipps',
    ev: Event,
  ): void {
    const wert = this.text(ev);
    this.aendere((r) => {
      const n = { ...r };
      if (wert.trim()) n[feld] = wert;
      else delete n[feld];
      return n;
    });
  }

  protected setzeNote(ev: Event): void {
    this.noteText.set(this.text(ev));
    this.geaendert.set(true);
    this.meldung.set(null);
  }

  /** Setzt eine Kernfrage; null = «Keine Angabe» (Feld entfernen). */
  private setzeKern<F extends 'lernzielePassend' | 'stoffAbgefragt' | 'schwierigkeit'>(
    k: Kernfrage,
    feld: F,
    w: PruefungsRueckmeldung[F] | null,
  ): void {
    this.beantwortet.update((b) => new Set([...b, k]));
    this.aendere((r) => {
      const n = { ...r };
      if (w === null || w === undefined) delete n[feld];
      else n[feld] = w;
      return n;
    });
  }

  protected setzePassend(w: 1 | 2 | 3 | 4 | 5 | null): void {
    this.setzeKern('passend', 'lernzielePassend', w);
  }

  protected setzeStoff(w: StoffAbdeckung | null): void {
    this.setzeKern('stoff', 'stoffAbgefragt', w);
  }

  protected setzeSchwierigkeit(w: SchwierigkeitVergleich | null): void {
    this.setzeKern('schwierigkeit', 'schwierigkeit', w);
  }

  protected setzeZeit(w: PruefungsZeit | null): void {
    this.aendere((r) => {
      const n = { ...r };
      if (w) n.zeit = w;
      else delete n.zeit;
      return n;
    });
  }

  protected setzeAbdeckung(index: number, w: LernzielAbdeckung): void {
    this.aendere((r) => ({
      ...r,
      lernziele: r.lernziele.map((lz, i) => (i === index ? { ...lz, abdeckung: w } : lz)),
    }));
  }

  /** «Alle übrigen: Ja» eines Themas: setzt nur Lernziele, die noch «Weiss nicht» sind. */
  protected uebrigeJa(indizes: readonly number[]): void {
    for (const i of indizes) this.setzeAbdeckung(i, 'ja');
  }

  protected umschaltenArt(art: Aufgabenart, an: boolean): void {
    this.aendere((r) => ({
      ...r,
      aufgabenarten: an
        ? [...new Set([...r.aufgabenarten, art])]
        : r.aufgabenarten.filter((a) => a !== art),
    }));
  }

  protected beispielHinzufuegen(): void {
    this.aendere((r) => ({ ...r, beispielfragen: [...r.beispielfragen, ''] }));
    const neu = (this.entwurf()?.beispielfragen.length ?? 1) - 1;
    afterNextRender(() => document.getElementById(`beispiel-${neu}`)?.focus(), {
      injector: this.injector,
    });
  }

  protected setzeBeispiel(index: number, ev: Event): void {
    const wert = this.text(ev);
    this.aendere((r) => ({
      ...r,
      beispielfragen: r.beispielfragen.map((b, i) => (i === index ? wert : b)),
    }));
  }

  protected beispielEntfernen(index: number): void {
    this.aendere((r) => ({ ...r, beispielfragen: r.beispielfragen.filter((_, i) => i !== index) }));
    // Fokus nicht auf <body> verlieren: nächste Beispielfrage oder «hinzufügen»
    const rest = this.entwurf()?.beispielfragen.length ?? 0;
    afterNextRender(
      () => {
        const ziel =
          rest > 0
            ? document.getElementById(`beispiel-${Math.min(index, rest - 1)}`)
            : document.getElementById('beispiel-hinzufuegen');
        ziel?.focus();
      },
      { injector: this.injector },
    );
  }

  // ---------- Speichern, Löschen ----------

  protected async speichern(): Promise<void> {
    const r = this.entwurf();
    if (!r || this.speichertGerade()) return;
    if (this.noteFehler()) {
      // Der Knopf ist nicht gesperrt: Die Erklärung steht sonst weit oben beim Feld
      this.meldung.set({
        text: `Die Note ist ungültig: ${this.noteFehler()} Korrigiere sie oder lass das Feld leer.`,
        art: 'fehler',
      });
      afterNextRender(
        () => {
          const el = document.getElementById('rm-note');
          el?.scrollIntoView?.({ block: 'center' });
          el?.focus({ preventScroll: true });
        },
        { injector: this.injector },
      );
      return;
    }
    const offen = KERNFRAGEN.filter((x) => this.offen().has(x.k)).map((x) => `«${x.frage}»`);
    const neu: PruefungsRueckmeldung = {
      ...r,
      lehrperson: r.lehrperson?.trim() || undefined,
      ausserhalb: r.ausserhalb?.trim() || undefined,
      tipps: r.tipps?.trim() || undefined,
      beispielfragen: r.beispielfragen.map((b) => b.trim()).filter(Boolean),
    };
    const note = parseZahl(this.noteText().trim());
    if (note !== null) neu.note = note;
    else delete neu.note;
    for (const k of ['lehrperson', 'ausserhalb', 'tipps', 'pruefungsdatum'] as const) {
      if (!neu[k]) delete neu[k];
    }
    this.speichertGerade.set(true);
    try {
      await this.rueckmeldungen.speichern(neu);
      this.entwurf.set(neu);
      this.geaendert.set(false);
      this.meldung.set({
        text: offen.length
          ? `Rückmeldung gespeichert. Danke! Noch ohne Antwort: ${offen.join(', ')} Du kannst das jederzeit ergänzen.`
          : 'Rückmeldung gespeichert. Danke!',
        art: 'erfolg',
      });
      afterNextRender(
        () => {
          const el = this.zusammenfassung()?.nativeElement;
          el?.scrollIntoView?.({ block: 'start' });
          el?.focus({ preventScroll: true });
        },
        { injector: this.injector },
      );
    } catch (e) {
      console.error(e);
      this.meldung.set({ text: 'Die Rückmeldung konnte nicht gespeichert werden.', art: 'fehler' });
    } finally {
      this.speichertGerade.set(false);
    }
  }

  protected async loeschen(): Promise<void> {
    const r = this.gespeichert();
    if (!r || !confirm('Diese Rückmeldung löschen? Das lässt sich nicht rückgängig machen.'))
      return;
    try {
      await this.rueckmeldungen.loeschen(r.id);
      this.geaendert.set(false);
      await this.router.navigate(['/lektion', this.id()]);
    } catch (e) {
      console.error(e);
      this.meldung.set({ text: 'Die Rückmeldung konnte nicht gelöscht werden.', art: 'fehler' });
    }
  }

  // ---------- Verlassen ----------

  protected vorDemVerlassen(ev: BeforeUnloadEvent): void {
    if (this.geaendert()) ev.preventDefault();
  }

  /** Für den CanDeactivate-Guard der Route: fragt bei ungespeicherten Änderungen nach. */
  kannVerlassen(): boolean {
    return (
      !this.geaendert() ||
      confirm('Deine Rückmeldung ist noch nicht gespeichert. Trotzdem verlassen?')
    );
  }
}
