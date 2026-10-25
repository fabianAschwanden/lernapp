import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { lesezeitMinuten } from '../../core/domain/kurzfassung';
import { halbeNote, istGenuegend } from '../../core/domain/note';
import {
  LernzielStand,
  STAND_LABEL,
  lektionAnteil,
  lernzielStaende,
} from '../../core/domain/planer';
import { SCHWIERIGKEIT_LABEL } from '../../core/domain/rueckmeldung';
import { FortschrittService } from '../../core/services/fortschritt.service';
import { LektionService } from '../../core/services/lektion.service';
import { RueckmeldungService } from '../../core/services/rueckmeldung.service';
import { ladeHerunter } from '../../core/util/datei';
import { HERKUNFT_LABEL, STUFE_KLASSE, countdownText, datumLang, tageBis } from './lektion-anzeige';

/** Übersicht einer Lektion: Aktionen, Lernstand je Lernziel, Prüfungsverlauf, Verwalten. */
@Component({
  selector: 'app-lektion-uebersicht',
  imports: [RouterLink, DatePipe, DecimalPipe],
  templateUrl: './lektion-uebersicht.html',
  styleUrl: './lektion-uebersicht.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LektionUebersicht {
  private readonly lektionService = inject(LektionService);
  private readonly fortschritt = inject(FortschrittService);
  private readonly rueckmeldungen = inject(RueckmeldungService);
  private readonly router = inject(Router);
  private readonly jetzt = new Date();

  /** Route-Parameter `:id`. */
  readonly id = input('');

  readonly standLabel = STAND_LABEL;
  readonly stufeKlasse = STUFE_KLASSE;
  readonly halbeNote = halbeNote;
  readonly istGenuegend = istGenuegend;

  readonly meldung = signal<{ text: string; art: 'erfolg' | 'fehler' } | null>(null);
  readonly beschaeftigt = signal(false);

  readonly lektion = computed(() => this.lektionService.lektion(this.id()));
  /** Defensiv: ältere, unvollständig importierte Lektionen haben evtl. keine Quellenliste. */
  readonly quellen = computed(() => {
    const q = this.lektion()?.quellen;
    return Array.isArray(q) ? q : [];
  });

  /** Lesezeit der Kurzfassung in Minuten; null, wenn die Lektion keine hat. */
  readonly kurzfassungMinuten = computed(() => {
    const k = this.lektion()?.kurzfassung;
    return typeof k === 'string' && k.trim() ? lesezeitMinuten(k) : null;
  });

  readonly staende = computed<LernzielStand[]>(() => {
    const l = this.lektion();
    return l ? lernzielStaende(l, this.fortschritt.map(), this.jetzt) : [];
  });

  /** Lernziele nach Thema gruppiert, in der Reihenfolge der Lektion. */
  readonly themen = computed(() => {
    const gruppen = new Map<string, LernzielStand[]>();
    for (const s of this.staende()) {
      const thema = s.lernziel.thema || 'Weitere Lernziele';
      gruppen.set(thema, [...(gruppen.get(thema) ?? []), s]);
    }
    return [...gruppen.entries()].map(([thema, staende]) => ({ thema, staende }));
  });

  readonly summe = computed(() =>
    this.staende().reduce(
      (s, x) => ({
        neu: s.neu + x.neu,
        faellig: s.faellig + x.faellig,
        fehler: s.fehler + x.fehler,
      }),
      { neu: 0, faellig: 0, fehler: 0 },
    ),
  );

  readonly prozent = computed(() => {
    const l = this.lektion();
    return l ? Math.round(lektionAnteil(l, this.fortschritt.map()) * 100) : 0;
  });

  readonly pruefung = computed(() => {
    const datum = this.lektion()?.pruefungsdatum;
    if (!datum) return null;
    return { datum: datumLang(datum), countdown: countdownText(tageBis(datum, this.jetzt)) };
  });

  /** Prüfungsdatum heute oder vorbei → Rückmeldung hervorheben. */
  readonly pruefungVorbei = computed(() => {
    const t = tageBis(this.lektion()?.pruefungsdatum, this.jetzt);
    return t !== null && t <= 0;
  });

  readonly rueckmeldung = computed(() => this.rueckmeldungen.fuerLektion(this.id()));

  /**
   * Kurzinfo zur Rückmeldung, z. B. «Schwierigkeit: Etwas schwerer · 4 von 6 beurteilten
   * Lernzielen dran (3 offen)». Unbeurteilte («weiss nicht») werden genannt, damit
   * «4 von 4» nicht nach dem ganzen Stoff aussieht.
   */
  readonly rueckmeldungInfo = computed(() => {
    const r = this.rueckmeldung();
    if (!r) return '';
    const teile: string[] = [];
    if (r.schwierigkeit !== undefined)
      teile.push(`Schwierigkeit: ${SCHWIERIGKEIT_LABEL[r.schwierigkeit]}`);
    const beurteilt = r.lernziele.filter((lz) => lz.abdeckung !== 'unklar');
    const offen = r.lernziele.length - beurteilt.length;
    if (beurteilt.length) {
      const dran = beurteilt.filter((lz) => lz.abdeckung !== 'nein').length;
      teile.push(
        offen > 0
          ? `${dran} von ${beurteilt.length} beurteilten Lernzielen dran (${offen} offen)`
          : `${dran} von ${beurteilt.length} Lernzielen dran`,
      );
    }
    return teile.join(' · ') || 'Gespeichert';
  });

  readonly herkunft = computed(() => {
    const l = this.lektion();
    return l ? HERKUNFT_LABEL[l.herkunft] : null;
  });

  readonly pruefungen = computed(() => this.fortschritt.pruefungenVon(this.id()));

  readonly istMitgeliefert = computed(
    () => this.lektion() !== undefined && this.lektionService.istMitgeliefert(this.id()),
  );
  readonly istBearbeiteteKopie = computed(
    () => this.lektion() !== undefined && this.lektionService.istBearbeiteteKopie(this.id()),
  );

  prozentVon(anteil: number): number {
    return Math.round(anteil * 100);
  }

  exportieren(): void {
    const l = this.lektion();
    if (!l) return;
    ladeHerunter(`${l.id}.json`, JSON.stringify(l, null, 2));
  }

  async zuruecksetzen(): Promise<void> {
    const l = this.lektion();
    if (!l || this.beschaeftigt()) return;
    if (
      !confirm(
        `Lernstand und Prüfungsverlauf von «${l.titel}» zurücksetzen? Das lässt sich nicht rückgängig machen.`,
      )
    ) {
      return;
    }
    await this.ausfuehren(
      () => this.fortschritt.zuruecksetzen(l.id),
      'Der Lernstand wurde zurückgesetzt.',
      'Der Lernstand konnte nicht zurückgesetzt werden.',
    );
  }

  async loeschen(): Promise<void> {
    const l = this.lektion();
    if (!l || this.beschaeftigt() || this.istMitgeliefert()) return;
    if (
      !confirm(
        `Lektion «${l.titel}» samt Lernstand löschen? Exportiere sie vorher, wenn du sie behalten willst.`,
      )
    ) {
      return;
    }
    const ok = await this.ausfuehren(
      async () => {
        await this.lektionService.loeschen(l.id);
        await this.fortschritt.zuruecksetzen(l.id);
      },
      '',
      'Die Lektion konnte nicht gelöscht werden.',
    );
    if (ok) await this.router.navigateByUrl('/');
  }

  async originalWiederherstellen(): Promise<void> {
    const l = this.lektion();
    if (!l || this.beschaeftigt() || !this.istBearbeiteteKopie()) return;
    if (
      !confirm(
        'Deine Änderungen an dieser Lektion verwerfen und das Original wiederherstellen? Der Lernstand bleibt erhalten.',
      )
    ) {
      return;
    }
    await this.ausfuehren(
      () => this.lektionService.loeschen(l.id),
      'Das Original ist wiederhergestellt.',
      'Das Original konnte nicht wiederhergestellt werden.',
    );
  }

  private async ausfuehren(
    aktion: () => Promise<void>,
    erfolg: string,
    fehler: string,
  ): Promise<boolean> {
    this.beschaeftigt.set(true);
    this.meldung.set(null);
    try {
      await aktion();
      if (erfolg) this.meldung.set({ text: erfolg, art: 'erfolg' });
      return true;
    } catch (e) {
      console.error(e);
      this.meldung.set({ text: fehler, art: 'fehler' });
      return false;
    } finally {
      this.beschaeftigt.set(false);
    }
  }
}
