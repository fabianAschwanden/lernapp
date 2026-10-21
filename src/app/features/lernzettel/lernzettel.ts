import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  input,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, Scroll } from '@angular/router';
import { filter, take } from 'rxjs';

import { Lernziel } from '../../core/models/lektion.model';
import { LektionService } from '../../core/services/lektion.service';
import { MdPipe } from '../../shared/md.pipe';

/** Lernzettel einer Lektion: Zusammenfassung, Merksätze und Abbildungen je Lernziel, druckbar. */
@Component({
  selector: 'app-lernzettel',
  imports: [RouterLink, MdPipe],
  templateUrl: './lernzettel.html',
  styleUrl: './lernzettel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Lernzettel {
  private readonly lektionService = inject(LektionService);
  private readonly document = inject(DOCUMENT);

  /** Route-Parameter `:id`. */
  readonly id = input('');
  /** Query-Parameter `lz`: zu diesem Lernziel springen. */
  readonly lz = input<string | undefined>();

  readonly lektion = computed(() => this.lektionService.lektion(this.id()));

  readonly hatKurzfassung = computed(() => {
    const k = this.lektion()?.kurzfassung;
    return typeof k === 'string' && k.trim().length > 0;
  });

  /** Lernziele nach Thema gruppiert, in der Reihenfolge der Lektion. */
  readonly themen = computed(() => {
    const gruppen = new Map<string, Lernziel[]>();
    for (const lz of this.lektion()?.lernziele ?? []) {
      const thema = lz.thema || 'Weitere Lernziele';
      gruppen.set(thema, [...(gruppen.get(thema) ?? []), lz]);
    }
    return [...gruppen.entries()].map(([thema, lernziele]) => ({ thema, lernziele }));
  });

  /** Lernziele, zu denen es Fragen gibt (für «Dazu üben»). */
  readonly mitFragen = computed(
    () => new Set(this.lektion()?.fragen.map((f) => f.lernzielId) ?? []),
  );

  constructor() {
    // Der Router scrollt nach der Navigation nach oben (scrollPositionRestoration: 'top').
    // Darum zweimal springen: direkt nach dem Rendern und nach dem Scroll-Ereignis des Routers.
    // Das Scroll-Ereignis kann uns erreichen, bevor der Router selbst nach oben scrollt
    // (Reihenfolge der Abonnenten) — deshalb erst im nächsten Task springen.
    afterNextRender(() => this.springeZuLernziel());
    const zerstoert = inject(DestroyRef);
    inject(Router)
      .events.pipe(
        filter((e): e is Scroll => e instanceof Scroll),
        take(1),
        takeUntilDestroyed(zerstoert),
      )
      .subscribe(() => {
        const t = setTimeout(() => this.springeZuLernziel());
        zerstoert.onDestroy(() => clearTimeout(t));
      });
  }

  drucken(): void {
    window.print();
  }

  springeZu(elementId: string): void {
    const el = this.document.getElementById(elementId);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    el.focus({ preventScroll: true });
  }

  private springeZuLernziel(): void {
    const lz = this.lz();
    if (lz) this.springeZu(`lz-${lz}`);
  }
}
