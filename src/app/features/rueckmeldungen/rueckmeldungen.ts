import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  SCHWIERIGKEIT_LABEL,
  folgerungen,
  profilAlsText,
  profilSchluessel,
} from '../../core/domain/rueckmeldung';
import { LehrpersonProfil, PruefungsRueckmeldung } from '../../core/models/rueckmeldung.model';
import { LektionService } from '../../core/services/lektion.service';
import { RueckmeldungService } from '../../core/services/rueckmeldung.service';
import { ladeHerunter } from '../../core/util/datei';
import { MdPipe } from '../../shared/md.pipe';
import { datumLang } from '../lektion/lektion-anzeige';
import { exportDateiname, fachAnker, profilExport } from './profil-anzeige';
import { ProfilKennzahlen } from './profil-kennzahlen';

/**
 * Rückmeldungen nach Prüfungen, zusammengefasst pro Fach (= Lehrperson):
 * Kennzahlen, Beispielfragen, Tipps und Export für die Lektionserstellung.
 */
@Component({
  selector: 'app-rueckmeldungen',
  imports: [RouterLink, MdPipe, ProfilKennzahlen],
  templateUrl: './rueckmeldungen.html',
  styleUrl: './rueckmeldungen.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RueckmeldungenSeite {
  private readonly rueckmeldungen = inject(RueckmeldungService);
  private readonly lektionen = inject(LektionService);
  private readonly injector = inject(Injector);

  /** Query-Parameter `fach` (Profilschlüssel): springt zu diesem Fach. */
  readonly fach = input<string | undefined>();

  protected readonly profile = this.rueckmeldungen.profile;
  protected readonly schwierigkeitLabel = SCHWIERIGKEIT_LABEL;
  protected readonly anker = fachAnker;
  protected readonly datum = datumLang;

  /** Pro Fach: Profil, gesammelte Texte und die Folgerungen als Markdown-Liste. */
  protected readonly ansicht = computed(() =>
    this.profile().map((p) => ({
      p,
      beispielfragen: p.rueckmeldungen.flatMap((r) => r.beispielfragen.filter((b) => b.trim())),
      tipps: p.rueckmeldungen.flatMap((r) => (r.tipps?.trim() ? [r.tipps.trim()] : [])),
      ausserhalb: p.rueckmeldungen.flatMap((r) =>
        r.ausserhalb?.trim() ? [r.ausserhalb.trim()] : [],
      ),
      folgerungen: folgerungen(p)
        .map((f) => `- ${f}`)
        .join('\n'),
    })),
  );

  protected readonly meldung = signal<{
    schluessel: string;
    text: string;
    art: 'erfolg' | 'fehler';
  } | null>(null);
  /** Text zum manuellen Kopieren, wenn die Zwischenablage nicht geht. */
  protected readonly ersatzText = signal<{ schluessel: string; text: string } | null>(null);

  constructor() {
    effect(() => {
      const f = this.fach();
      // Nur bei neuem Parameter springen, nicht bei jeder Änderung der Profile
      if (!f || !untracked(this.profile).length) return;
      afterNextRender(
        () => {
          const el = document.getElementById(fachAnker(f));
          el?.scrollIntoView?.({ block: 'start' });
          el?.focus({ preventScroll: true });
        },
        { injector: this.injector },
      );
    });
  }

  protected lektionVorhanden(r: PruefungsRueckmeldung): boolean {
    return !!this.lektionen.lektion(r.lektionId);
  }

  protected async kopieren(p: LehrpersonProfil): Promise<void> {
    const text = profilAlsText(p);
    this.ersatzText.set(null);
    try {
      await navigator.clipboard.writeText(text);
      this.meldung.set({
        schluessel: p.schluessel,
        text: 'Kopiert. Füge den Text bei der Erstellung der nächsten Lektion ein, z. B. in Claude.',
        art: 'erfolg',
      });
    } catch {
      this.ersatzText.set({ schluessel: p.schluessel, text });
      this.meldung.set({
        schluessel: p.schluessel,
        text: 'Kopieren ging nicht automatisch. Markiere den Text unten und kopiere ihn selbst.',
        art: 'fehler',
      });
    }
  }

  protected herunterladen(p: LehrpersonProfil): void {
    ladeHerunter(exportDateiname(p), JSON.stringify(profilExport(p), null, 2));
    this.meldung.set({
      schluessel: p.schluessel,
      text: `${exportDateiname(p)} heruntergeladen.`,
      art: 'erfolg',
    });
  }

  protected async loeschen(r: PruefungsRueckmeldung): Promise<void> {
    if (
      !confirm(
        `Rückmeldung zu «${r.lektionTitel}» löschen? Das lässt sich nicht rückgängig machen.`,
      )
    )
      return;
    try {
      await this.rueckmeldungen.loeschen(r.id);
    } catch (e) {
      console.error(e);
      this.meldung.set({
        schluessel: profilSchluessel(r.fach),
        text: 'Die Rückmeldung konnte nicht gelöscht werden.',
        art: 'fehler',
      });
    }
  }

  protected markiere(ev: Event): void {
    (ev.target as HTMLTextAreaElement).select();
  }
}
