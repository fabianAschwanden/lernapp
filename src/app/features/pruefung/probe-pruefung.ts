import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { CanDeactivateFn, RouterLink } from '@angular/router';

import { Antwort, Pruefergebnis, pruefeAntwort } from '../../core/domain/antwort-pruefung';
import { berechneNote, halbeNote, istGenuegend } from '../../core/domain/note';
import { waehlePruefung } from '../../core/domain/planer';
import { pruefungsStil, schwierigkeitInWorten } from '../../core/domain/rueckmeldung';
import { PruefungsErgebnis } from '../../core/models/fortschritt.model';
import { Frage } from '../../core/models/lektion.model';
import { AUFGABENART_LABEL } from '../../core/models/rueckmeldung.model';
import { EinstellungenService } from '../../core/services/einstellungen.service';
import { FortschrittService } from '../../core/services/fortschritt.service';
import { LektionService } from '../../core/services/lektion.service';
import { RueckmeldungService } from '../../core/services/rueckmeldung.service';
import { BEWERTUNG_CHIP, BEWERTUNG_LABEL, istBeantwortet, kurzText } from '../../shared/frage/antwort-hilfe';
import { FrageKarte, Mischungen } from '../../shared/frage/frage-karte';
import { kurzArt } from '../rueckmeldungen/profil-anzeige';

type Phase = 'start' | 'laeuft' | 'korrektur' | 'auswertung';

interface FrageAuswertung {
  nr: number;
  frage: Frage;
  antwort: Antwort | null;
  ergebnis: Pruefergebnis;
  beantwortet: boolean;
}

/** Verhindert, dass eine laufende Prüfung per In-App-Navigation versehentlich verlassen wird. */
export const probePruefungVerlassen: CanDeactivateFn<ProbePruefung> = (c) => c.darfVerlassen();

const fmtPunkte = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 });
const fmtNote = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/**
 * Probeprüfung: Fragen über alle Lernziele, optional mit Zeitlimit, ohne
 * Rückmeldung bis zur Abgabe. Danach Selbstkorrektur offener Fragen,
 * Note nach Schweizer Skala und Auswertung pro Lernziel.
 */
@Component({
  selector: 'app-probe-pruefung',
  imports: [RouterLink, FrageKarte],
  templateUrl: './probe-pruefung.html',
  styleUrl: './probe-pruefung.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'vorDemVerlassen($event)' },
})
export class ProbePruefung {
  private readonly lektionen = inject(LektionService);
  private readonly fortschritt = inject(FortschrittService);
  private readonly einstellungen = inject(EinstellungenService);
  private readonly rueckmeldungen = inject(RueckmeldungService);
  private readonly injector = inject(Injector);

  /** Route-Parameter `:id`. */
  readonly id = input('');

  protected readonly lektion = computed(() => this.lektionen.lektion(this.id()));
  protected readonly geladen = this.lektionen.geladen;

  protected readonly bewertungLabel = BEWERTUNG_LABEL;
  protected readonly bewertungChip = BEWERTUNG_CHIP;
  protected readonly kurzText = kurzText;

  protected readonly anzahl = computed(() =>
    Math.min(this.einstellungen.werte().pruefungAnzahl, this.lektion()?.fragen.length ?? 0),
  );
  protected readonly minuten = computed(() => this.einstellungen.werte().pruefungMinuten);

  /** Profil der Lehrperson (Rückmeldungen früherer Prüfungen im selben Fach). */
  protected readonly profil = computed(() => {
    const l = this.lektion();
    return l ? this.rueckmeldungen.profilFuerFach(l.fach) : null;
  });
  /** Fragen nach dem Stil der Lehrperson auswählen (Schalter auf dem Startbildschirm). */
  protected readonly nachStil = signal(true);
  /** «Prüfungen eher schwerer als das Üben mit der App; oft: Rechnen, Erklären …» */
  protected readonly stilText = computed(() => {
    const p = this.profil();
    if (!p) return '';
    const arten = p.aufgabenarten.slice(0, 3).map((a) => kurzArt(AUFGABENART_LABEL[a.art]));
    const teile = [
      ...(p.schwierigkeitMittel !== null
        ? [`Prüfungen ${schwierigkeitInWorten(p.schwierigkeitMittel)}`]
        : []),
      ...(arten.length ? [`oft: ${arten.join('; ')}`] : []),
    ];
    const t = teile.join('; ');
    return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : '';
  });

  // ---------- Zustand ----------

  protected readonly phase = signal<Phase>('start');
  protected readonly fragen = signal<Frage[]>([]);
  protected readonly index = signal(0);
  protected readonly antworten = signal<Map<string, Antwort>>(new Map());
  /** Eigener Text bei offenen Fragen. */
  protected readonly texte = signal<Map<string, string>>(new Map());
  protected readonly bestaetigen = signal(false);
  protected readonly speicherFehler = signal(false);
  private readonly offeneDetails = signal<Set<string>>(new Set());
  /** Gemischte Reihenfolgen dieses Durchlaufs — jede neue Prüfung mischt neu. */
  protected mischungen: Mischungen = new Map();

  private startMs = 0;
  private endeMs = 0;
  private abgabeMs = 0;
  protected readonly jetzt = signal(Date.now());
  private takt: ReturnType<typeof setInterval> | undefined;

  protected readonly aktuelle = computed<Frage | undefined>(() => this.fragen()[this.index()]);

  protected readonly restSekunden = computed(() =>
    this.endeMs ? Math.max(0, Math.ceil((this.endeMs - this.jetzt()) / 1000)) : null,
  );
  protected readonly zeitKnapp = computed(() => {
    const r = this.restSekunden();
    return r !== null && r <= 60;
  });

  protected readonly beantwortetIds = computed(() => {
    const a = this.antworten();
    const t = this.texte();
    return new Set(
      this.fragen()
        .filter((f) => (f.typ === 'offen' ? !!t.get(f.id)?.trim() : istBeantwortet(a.get(f.id))))
        .map((f) => f.id),
    );
  });
  protected readonly unbeantwortet = computed(() => this.fragen().length - this.beantwortetIds().size);

  /** Offene Fragen mit eigenem Text, die nach der Abgabe selbst bewertet werden. */
  protected readonly zuKorrigieren = computed(() =>
    this.fragen().filter((f) => f.typ === 'offen' && !!this.texte().get(f.id)?.trim()),
  );
  protected readonly korrekturFertig = computed(() =>
    this.zuKorrigieren().every((f) => this.antworten().get(f.id)?.typ === 'offen'),
  );

  protected readonly auswertung = computed<FrageAuswertung[]>(() => {
    const a = this.antworten();
    const ids = this.beantwortetIds();
    return this.fragen().map((frage, i) => {
      const antwort = a.get(frage.id) ?? null;
      const beantwortet = ids.has(frage.id) && !!antwort;
      const ergebnis: Pruefergebnis =
        beantwortet && antwort ? pruefeAntwort(frage, antwort) : { bewertung: 'falsch', anteil: 0 };
      return { nr: i + 1, frage, antwort, ergebnis, beantwortet };
    });
  });

  protected readonly resultat = computed(() => {
    const liste = this.auswertung();
    const punkte = liste.reduce((s, x) => s + x.ergebnis.anteil, 0);
    const max = liste.length;
    const note = berechneNote(punkte, max);
    const proLernziel: Record<string, { punkte: number; max: number }> = {};
    for (const x of liste) {
      const e = (proLernziel[x.frage.lernzielId] ??= { punkte: 0, max: 0 });
      e.punkte += x.ergebnis.anteil;
      e.max += 1;
    }
    return { punkte, max, note, gerundet: halbeNote(note), genuegend: istGenuegend(note), proLernziel };
  });

  protected readonly lernzielZeilen = computed(() => {
    const l = this.lektion();
    const pro = this.resultat().proLernziel;
    if (!l) return [];
    return l.lernziele
      .filter((lz) => pro[lz.id])
      .map((lz) => {
        const { punkte, max } = pro[lz.id];
        const anteil = max ? punkte / max : 0;
        return {
          lernziel: lz,
          punkte,
          max,
          prozent: Math.round(anteil * 100),
          klasse: anteil >= 0.8 ? 'gut' : anteil >= 0.5 ? 'mittel' : 'schlecht',
        };
      });
  });

  protected readonly dauerSekunden = signal(0);

  private readonly fragenKopf = viewChild<ElementRef<HTMLElement>>('fragenKopf');
  private gespeichert = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stoppeTakt());

    // Zeit abgelaufen → automatisch abgeben.
    effect(() => {
      if (this.phase() === 'laeuft' && this.restSekunden() === 0) untracked(() => this.abgeben(true));
    });
  }

  // ---------- Ablauf ----------

  protected starten(): void {
    const l = this.lektion();
    if (!l) return;
    const stil = this.nachStil() ? pruefungsStil(this.profil()) : null;
    this.fragen.set(waehlePruefung(l, this.anzahl(), Math.random, stil));
    this.mischungen = new Map();
    this.antworten.set(new Map());
    this.texte.set(new Map());
    this.offeneDetails.set(new Set());
    this.index.set(0);
    this.bestaetigen.set(false);
    this.speicherFehler.set(false);
    this.gespeichert = false;
    this.startMs = Date.now();
    this.endeMs = this.minuten() > 0 ? this.startMs + this.minuten() * 60_000 : 0;
    this.jetzt.set(this.startMs);
    this.stoppeTakt();
    this.takt = setInterval(() => this.jetzt.set(Date.now()), 1000);
    this.phase.set('laeuft');
    this.fokusOben();
  }

  protected gehe(i: number): void {
    if (i < 0 || i >= this.fragen().length) return;
    this.index.set(i);
    this.bestaetigen.set(false);
    this.fokusOben();
  }

  /**
   * Fragenübersicht als eine Tab-Station: Nur die aktuelle Nummer ist per Tab
   * erreichbar, Pfeiltasten (und Pos1/Ende) wechseln zwischen den Nummern.
   */
  protected nummernTaste(ev: KeyboardEvent): void {
    const knoepfe = [...(ev.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')];
    const jetzt = knoepfe.indexOf(ev.target as HTMLButtonElement);
    if (jetzt < 0) return;
    const ziel =
      ev.key === 'ArrowRight' || ev.key === 'ArrowDown'
        ? Math.min(jetzt + 1, knoepfe.length - 1)
        : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp'
          ? Math.max(jetzt - 1, 0)
          : ev.key === 'Home'
            ? 0
            : ev.key === 'End'
              ? knoepfe.length - 1
              : -1;
    if (ziel < 0) return;
    ev.preventDefault();
    knoepfe[ziel]?.focus();
  }

  protected setzeAntwort(frage: Frage, a: Antwort): void {
    this.antworten.update((m) => new Map(m).set(frage.id, a));
  }

  protected setzeText(frage: Frage, text: string): void {
    this.texte.update((m) => new Map(m).set(frage.id, text));
  }

  protected abgebenKlick(): void {
    if (this.unbeantwortet() > 0 && !this.bestaetigen()) {
      this.bestaetigen.set(true);
      return;
    }
    this.abgeben(false);
  }

  protected abgeben(automatisch: boolean): void {
    if (this.phase() !== 'laeuft') return;
    this.stoppeTakt();
    this.abgabeMs = Date.now();
    const limit = this.endeMs ? this.endeMs - this.startMs : Infinity;
    this.dauerSekunden.set(Math.round(Math.min(this.abgabeMs - this.startMs, limit) / 1000));
    this.bestaetigen.set(false);
    this.zeitAbgelaufen.set(automatisch);
    if (this.zuKorrigieren().length) {
      this.phase.set('korrektur');
      this.fokusOben();
    } else {
      this.auswerten();
    }
  }

  protected readonly zeitAbgelaufen = signal(false);

  protected auswerten(): void {
    if (!this.korrekturFertig()) return;
    this.phase.set('auswertung');
    this.fokusOben();
    void this.speichern();
  }

  protected neuePruefung(): void {
    this.phase.set('start');
    this.fragen.set([]);
    this.fokusOben();
  }

  // ---------- Auswertung ----------

  protected istOffen(id: string): boolean {
    return this.offeneDetails().has(id);
  }

  protected umschalten(id: string, ev: Event): void {
    const offen = (ev.target as HTMLDetailsElement).open;
    this.offeneDetails.update((s) => {
      const n = new Set(s);
      if (offen) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  protected punkte(n: number): string {
    return fmtPunkte.format(n);
  }

  protected note(n: number): string {
    return fmtNote.format(n);
  }

  protected zeit(sekunden: number): string {
    const m = Math.floor(sekunden / 60);
    const s = sekunden % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  protected dauerText(sekunden: number): string {
    const m = Math.floor(sekunden / 60);
    const s = sekunden % 60;
    return m ? `${m} min ${s} s` : `${s} s`;
  }

  // ---------- Verlassen verhindern ----------

  protected vorDemVerlassen(ev: BeforeUnloadEvent): void {
    if (this.phase() === 'laeuft' || this.phase() === 'korrektur') {
      ev.preventDefault();
      ev.returnValue = '';
    }
  }

  /** Für einen CanDeactivate-Guard: fragt nach, solange die Prüfung läuft. */
  darfVerlassen(): boolean {
    if (this.phase() !== 'laeuft' && this.phase() !== 'korrektur') return true;
    return window.confirm('Die Probeprüfung läuft noch. Wenn du die Seite verlässt, gehen deine Antworten verloren. Trotzdem verlassen?');
  }

  // ---------- intern ----------

  private async speichern(): Promise<void> {
    const l = this.lektion();
    if (!l || this.gespeichert) return;
    this.gespeichert = true;
    const r = this.resultat();
    const ergebnis: PruefungsErgebnis = {
      id: crypto.randomUUID(),
      lektionId: l.id,
      am: new Date(this.abgabeMs || Date.now()).toISOString(),
      punkte: Math.round(r.punkte * 100) / 100,
      maxPunkte: r.max,
      note: r.note,
      dauerSekunden: this.dauerSekunden(),
      proLernziel: r.proLernziel,
    };
    try {
      await this.fortschritt.speicherePruefung(ergebnis);
      const jetzt = new Date();
      for (const x of this.auswertung()) {
        await this.fortschritt.verbuche(l, x.frage, x.ergebnis.bewertung, jetzt);
      }
    } catch (e) {
      console.error('Probeprüfung nicht gespeichert', e);
      this.speicherFehler.set(true);
    }
  }

  private stoppeTakt(): void {
    if (this.takt !== undefined) clearInterval(this.takt);
    this.takt = undefined;
  }

  private fokusOben(): void {
    afterNextRender(
      () => {
        // Alle Kopfzeilen stehen zuoberst auf der Seite; die laufende Prüfung hat
        // einen sticky Kopf, bei dem scrollIntoView nichts bewirken würde.
        window.scrollTo?.({ top: 0 });
        this.fragenKopf()?.nativeElement.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }
}
