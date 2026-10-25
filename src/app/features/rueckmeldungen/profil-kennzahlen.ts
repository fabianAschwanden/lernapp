import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { LehrpersonProfil } from '../../core/models/rueckmeldung.model';
import { kennzahlen } from './profil-anzeige';

/** Kennzahlen eines Fach-Profils als Beschreibungsliste. */
@Component({
  selector: 'app-profil-kennzahlen',
  template: `
    <dl class="kennzahlen klein">
      @for (k of zeilen(); track k.name) {
        <div>
          <dt>{{ k.name }}</dt>
          <dd>{{ k.wert }}</dd>
        </div>
      }
    </dl>
  `,
  styles: `
    .kennzahlen {
      margin: 0;
      display: grid;
      gap: 6px;
    }
    .kennzahlen div {
      display: grid;
      grid-template-columns: minmax(7.5rem, 35%) 1fr;
      gap: 8px;
    }
    dt {
      font-weight: 600;
      color: var(--text-2);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilKennzahlen {
  readonly profil = input.required<LehrpersonProfil>();
  /** Notenschnitt anzeigen (nur auf der Profil-Seite). */
  readonly mitNote = input(false);

  protected readonly zeilen = computed(() => kennzahlen(this.profil(), this.mitNote()));
}
