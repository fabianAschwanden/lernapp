import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  FortschrittMap,
  istFaellig,
  fortschrittVon,
  lektionAnteil,
} from '../../core/domain/planer';
import { LektionKopf } from '../../core/models/lektion.model';
import { FortschrittService } from '../../core/services/fortschritt.service';
import { LektionService } from '../../core/services/lektion.service';
import { HERKUNFT_LABEL, countdownText, datumLang, tageBis } from '../lektion/lektion-anzeige';

interface LektionKarte {
  kopf: LektionKopf;
  /** Gesamtstand in Prozent (0–100). */
  prozent: number;
  neu: number;
  faellig: number;
  tage: number | null;
  countdown: string | null;
  datum: string | null;
  herkunft: string | null;
}

/** Startseite: Weiterlernen-Vorschlag und alle Lektionen nach Fach. */
@Component({
  selector: 'app-start',
  imports: [RouterLink],
  templateUrl: './start.html',
  styleUrl: './start.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartSeite {
  private readonly lektionService = inject(LektionService);
  private readonly fortschritt = inject(FortschrittService);
  private readonly jetzt = new Date();

  readonly ladefehler = this.lektionService.ladefehler;

  readonly faecher = computed(() => {
    const map = this.fortschritt.map();
    return this.lektionService.faecher().map(({ fach, lektionen }) => ({
      fach,
      lektionen: lektionen.map((kopf) => this.karte(kopf, map)),
    }));
  });

  readonly hatLektionen = computed(() => this.faecher().length > 0);

  /** Dringlichste Lektion mit neuen oder fälligen Fragen: nächste Prüfung zuerst, sonst meiste fällige. */
  readonly weiterlernen = computed<LektionKarte | null>(() => {
    const offen = this.faecher()
      .flatMap((f) => f.lektionen)
      .filter((k) => k.neu + k.faellig > 0);
    const mitPruefung = (k: LektionKarte) => k.tage !== null && k.tage >= 0;
    offen.sort((a, b) => {
      const pa = mitPruefung(a);
      const pb = mitPruefung(b);
      if (pa !== pb) return pa ? -1 : 1;
      if (pa && pb && a.tage !== b.tage) return a.tage! - b.tage!;
      return b.faellig - a.faellig || b.neu - a.neu;
    });
    return offen[0] ?? null;
  });

  private karte(kopf: LektionKopf, map: FortschrittMap): LektionKarte {
    const lektion = this.lektionService.lektion(kopf.id);
    let neu = 0;
    let faellig = 0;
    if (lektion) {
      for (const frage of lektion.fragen) {
        const fs = fortschrittVon(lektion.id, frage, map);
        if (fs.fach === 0) neu++;
        else if (istFaellig(fs, this.jetzt)) faellig++;
      }
    }
    const tage = tageBis(kopf.pruefungsdatum, this.jetzt);
    const countdown = countdownText(tage);
    return {
      kopf,
      prozent: lektion ? Math.round(lektionAnteil(lektion, map) * 100) : 0,
      neu,
      faellig,
      tage,
      countdown,
      datum: countdown && kopf.pruefungsdatum ? datumLang(kopf.pruefungsdatum) : null,
      herkunft: HERKUNFT_LABEL[kopf.herkunft] ?? null,
    };
  }
}
