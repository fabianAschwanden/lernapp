import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Antwort, Pruefergebnis, pruefeAntwort } from '../../core/domain/antwort-pruefung';
import { STAND_LABEL, StandStufe, lernzielStaende, waehleFragen } from '../../core/domain/planer';
import { Bewertung } from '../../core/models/fortschritt.model';
import { Frage, Lektion } from '../../core/models/lektion.model';
import { EinstellungenService } from '../../core/services/einstellungen.service';
import { FortschrittService } from '../../core/services/fortschritt.service';
import { LektionService } from '../../core/services/lektion.service';
import { FrageKarte } from '../../shared/frage/frage-karte';

export type LernModus = 'lernen' | 'lernziel' | 'fehler';

interface Schritt {
  /** Laufnummer — erzwingt eine frische FrageKarte, auch wenn dieselbe Frage nochmals kommt. */
  nr: number;
  frage: Frage;
  wiederholung: boolean;
}

const STAND_CHIP: Record<StandStufe, string> = { neu: '', 'am-lernen': 'schlecht', fast: 'mittel', sitzt: 'gut' };

/**
 * Eine Lernrunde: Fragen nach Leitner-Dringlichkeit, sofortige Rückmeldung,
 * falsch beantwortete Fragen kommen am Ende der Runde einmal nochmals dran.
 */
@Component({
  selector: 'app-lern-sitzung',
  imports: [RouterLink, FrageKarte],
  templateUrl: './lern-sitzung.html',
  styleUrl: './lern-sitzung.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LernSitzung {
  private readonly lektionen = inject(LektionService);
  private readonly fortschritt = inject(FortschrittService);
  private readonly einstellungen = inject(EinstellungenService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  /** Route-Parameter `:id`. */
  readonly id = input('');
  /** Query-Parameter `modus`. */
  readonly modus = input<string | undefined>('lernen');
  /** Query-Parameter `lz` (Lernziel-id). */
  readonly lz = input<string | undefined>();

  protected readonly standLabel = STAND_LABEL;
  protected readonly standChip = STAND_CHIP;

  protected readonly lektion = computed(() => this.lektionen.lektion(this.id()));
  protected readonly geladen = this.lektionen.geladen;

  protected readonly modusNorm = computed<LernModus>(() => {
    if (this.modus() === 'fehler') return 'fehler';
    return this.lz() ? 'lernziel' : 'lernen';
  });

  protected readonly lernziel = computed(() => {
    const id = this.lz();
    return id ? this.lektion()?.lernziele.find((l) => l.id === id) : undefined;
  });

  /** Kurzer Titel; den vollen Lernzieltext zeigt die Seite darunter (nicht mitten im Wort gekürzt). */
  protected readonly titel = computed(() => {
    const lz = this.lernziel();
    if (this.modusNorm() === 'fehler') return lz?.thema ? `Fehler wiederholen: ${lz.thema}` : 'Fehler wiederholen';
    if (lz) return lz.thema ? `Üben: ${lz.thema}` : 'Lernziel üben';
    return 'Lernen';
  });

  // ---------- Rundenzustand ----------

  protected readonly schritte = signal<Schritt[]>([]);
  protected readonly index = signal(0);
  protected readonly ergebnis = signal<Pruefergebnis | null>(null);
  protected readonly gestartet = signal(false);
  /** Erste Bewertung je Frage in dieser Runde (für die Zusammenfassung). */
  private readonly erste = signal<Map<string, Bewertung>>(new Map());
  /** Bewertungen in der Wiederholung. */
  private readonly wiederholt = signal<Bewertung[]>([]);

  protected readonly aktuell = computed<Schritt | undefined>(() => this.schritte()[this.index()]);
  protected readonly fertig = computed(() => this.gestartet() && this.schritte().length > 0 && !this.aktuell());

  /**
   * Wiederholungen werden hinten angehängt. Gezählt wird trotzdem nur die
   * eigentliche Runde, damit das Ende nicht immer weiter wegrückt und der
   * Balken nicht zurückspringt; Wiederholungen erscheinen separat.
   */
  private readonly hauptAnzahl = computed(() => this.schritte().filter((s) => !s.wiederholung).length);
  private readonly anzahlWiederholungen = computed(() => this.schritte().length - this.hauptAnzahl());

  protected readonly positionText = computed(() => {
    const s = this.aktuell();
    if (!s) return '';
    const haupt = this.hauptAnzahl();
    const wdh = this.anzahlWiederholungen();
    if (s.wiederholung) return `Wiederholung ${this.index() - haupt + 1} von ${wdh}`;
    const zusatz = wdh ? ` · +${wdh} ${wdh === 1 ? 'Wiederholung' : 'Wiederholungen'}` : '';
    return `Frage ${this.index() + 1} von ${haupt}${zusatz}`;
  });

  protected readonly anteil = computed(() => {
    const haupt = this.hauptAnzahl();
    return haupt ? Math.min(haupt, this.index() + (this.ergebnis() ? 1 : 0)) / haupt : 0;
  });

  protected readonly aktuellesLernziel = computed(() => {
    const s = this.aktuell();
    return s ? this.lektion()?.lernziele.find((l) => l.id === s.frage.lernzielId) : undefined;
  });

  protected readonly zusammenfassung = computed(() => {
    const werte = [...this.erste().values()];
    const zaehle = (b: Bewertung) => werte.filter((w) => w === b).length;
    const wiederholt = this.wiederholt();
    return {
      richtig: zaehle('richtig'),
      teilweise: zaehle('teilweise'),
      falsch: zaehle('falsch'),
      gesamt: werte.length,
      wiederholtRichtig: wiederholt.filter((w) => w === 'richtig').length,
      wiederholt: wiederholt.length,
    };
  });

  /** Lernziele, die in dieser Runde vorkamen, mit aktuellem Stand. */
  protected readonly betroffeneLernziele = computed(() => {
    const l = this.lektion();
    if (!l || !this.fertig()) return [];
    const ids = new Set(this.schritte().map((s) => s.frage.lernzielId));
    return lernzielStaende(l, this.fortschritt.map(), new Date()).filter((s) => ids.has(s.lernziel.id));
  });

  private readonly weiterKnopf = viewChild<ElementRef<HTMLButtonElement>>('weiterKnopf');
  private readonly fortschrittKopf = viewChild<ElementRef<HTMLElement>>('fortschrittKopf');
  private naechsteNr = 0;

  constructor() {
    // Runde einmal beim Start berechnen — nicht reaktiv auf den Lernstand,
    // sonst würde die Runde nach jeder Antwort neu zusammengestellt.
    effect(() => {
      const l = this.lektion();
      const modus = this.modusNorm();
      const lz = this.lz();
      untracked(() => this.starteRunde(l, modus, lz));
    });

    // Nach der Rückmeldung landet der Fokus auf «Weiter» — und «Weiter» wird sichtbar
    // gescrollt, auch wenn er schon im Fenster, aber unter der unteren Navigation läge
    // (scroll-padding-bottom in styles.css).
    afterRenderEffect(() => {
      const knopf = this.weiterKnopf()?.nativeElement;
      if (!knopf) return;
      knopf.focus({ preventScroll: true });
      knopf.scrollIntoView?.({ block: 'nearest' });
    });
  }

  protected beantwortet(antwort: Antwort): void {
    const l = this.lektion();
    const s = this.aktuell();
    if (!l || !s || this.ergebnis()) return;
    const erg = pruefeAntwort(s.frage, antwort);
    this.ergebnis.set(erg);

    if (s.wiederholung) {
      this.wiederholt.update((w) => [...w, erg.bewertung]);
    } else {
      this.erste.update((m) => new Map(m).set(s.frage.id, erg.bewertung));
      if (erg.bewertung !== 'richtig') {
        this.schritte.update((liste) => [...liste, { nr: this.naechsteNr++, frage: s.frage, wiederholung: true }]);
      }
    }

    this.fortschritt.verbuche(l, s.frage, erg.bewertung).catch((e) => console.error('Lernstand nicht gespeichert', e));
  }

  protected weiter(): void {
    this.ergebnis.set(null);
    this.index.update((i) => i + 1);
    afterNextRender(() => this.fortschrittKopf()?.nativeElement.focus(), { injector: this.injector });
  }

  protected naechsteRunde(): void {
    this.starteRunde(this.lektion(), this.modusNorm(), this.lz());
  }

  protected fehlerWiederholen(): void {
    if (this.modusNorm() === 'fehler') {
      this.naechsteRunde();
      return;
    }
    this.router.navigate([], { queryParams: { modus: 'fehler' }, queryParamsHandling: 'merge' });
  }

  protected hatFehler = computed(() => {
    const z = this.zusammenfassung();
    return z.teilweise + z.falsch > 0;
  });

  protected prozent(anteil: number): number {
    return Math.round(anteil * 100);
  }

  private starteRunde(l: Lektion | undefined, modus: LernModus, lz: string | undefined): void {
    this.index.set(0);
    this.ergebnis.set(null);
    this.erste.set(new Map());
    this.wiederholt.set([]);
    if (!l) {
      this.schritte.set([]);
      this.gestartet.set(false);
      return;
    }
    const fragen = waehleFragen(l, this.fortschritt.map(), {
      anzahl: this.einstellungen.werte().rundenGroesse,
      lernzielId: lz || undefined,
      nurFehler: modus === 'fehler',
      jetzt: new Date(),
    });
    this.schritte.set(fragen.map((frage) => ({ nr: this.naechsteNr++, frage, wiederholung: false })));
    this.gestartet.set(true);
    window.scrollTo?.({ top: 0 });
    // Definierter Startfokus: «Frage 1 von …» (Screenreader hören, dass die Runde begonnen hat)
    afterNextRender(() => this.fortschrittKopf()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }
}
