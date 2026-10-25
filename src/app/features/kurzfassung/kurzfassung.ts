import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { lernzieleJeAbschnitt, lesezeitMinuten, teileKurzfassung } from '../../core/domain/kurzfassung';
import { LektionService } from '../../core/services/lektion.service';
import { MdPipe } from '../../shared/md.pipe';
import { countdownText, datumLang, tageBis } from '../lektion/lektion-anzeige';

/**
 * Kurzfassung einer Lektion zum Durchlesen: Abschnitte an den «## »-Überschriften,
 * je als Karte mit Sprungmarke und den Lernzielen des gleichnamigen Themas,
 * dazu Lesezeit, Prüfungsdatum und Hinweise. Druckbar.
 */
@Component({
  selector: 'app-kurzfassung',
  imports: [RouterLink, MdPipe],
  templateUrl: './kurzfassung.html',
  styleUrl: './kurzfassung.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Kurzfassung {
  private readonly lektionService = inject(LektionService);
  private readonly document = inject(DOCUMENT);
  private readonly jetzt = new Date();

  /** Route-Parameter `:id`. */
  readonly id = input('');

  readonly lektion = computed(() => this.lektionService.lektion(this.id()));

  /** Nur Text gilt als Kurzfassung (beschädigte Importe sollen nicht abstürzen). */
  readonly text = computed(() => {
    const k = this.lektion()?.kurzfassung;
    return typeof k === 'string' ? k.trim() : '';
  });

  readonly gliederung = computed(() => teileKurzfassung(this.text()));
  /** Lernziele, auf die sich jeder Abschnitt bezieht (über das gleichnamige Thema). */
  readonly lernziele = computed(() =>
    lernzieleJeAbschnitt(this.gliederung().abschnitte, this.lektion()?.lernziele ?? []),
  );
  readonly lesezeit = computed(() => lesezeitMinuten(this.text()));

  readonly pruefung = computed(() => {
    const datum = this.lektion()?.pruefungsdatum;
    if (!datum) return null;
    return { datum: datumLang(datum), countdown: countdownText(tageBis(datum, this.jetzt)) };
  });

  readonly hatFragen = computed(() => (this.lektion()?.fragen.length ?? 0) > 0);

  drucken(): void {
    window.print();
  }

  springeZu(elementId: string): void {
    const el = this.document.getElementById(elementId);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    el.focus({ preventScroll: true });
  }
}
