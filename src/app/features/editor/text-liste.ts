import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Bearbeitet eine Liste kurzer Texte (Hinweise, Merksätze, akzeptierte
 * Antworten …): Einträge ändern, hinzufügen, entfernen, optional verschieben.
 * Gibt jede Änderung als neue Liste aus.
 */
@Component({
  selector: 'app-text-liste',
  templateUrl: './text-liste.html',
  styleUrl: './text-liste.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextListe {
  readonly werte = input<string[]>([]);
  /** Beschriftung der Liste (für Screenreader und Knopftexte). */
  readonly bezeichnung = input.required<string>();
  readonly platzhalter = input('');
  readonly sortierbar = input(false);
  /** Längere Texte (Hinweise, Merksätze): mitwachsendes Textfeld statt einzeiliger Eingabe. */
  readonly mehrzeilig = input(false);
  readonly aenderung = output<string[]>();

  setze(i: number, e: Event): void {
    const neu = [...this.werte()];
    neu[i] = (e.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.aenderung.emit(neu);
  }

  hinzufuegen(): void {
    this.aenderung.emit([...this.werte(), '']);
  }

  entfernen(i: number): void {
    this.aenderung.emit(this.werte().filter((_, j) => j !== i));
  }

  verschieben(i: number, richtung: -1 | 1): void {
    const neu = [...this.werte()];
    const ziel = i + richtung;
    if (ziel < 0 || ziel >= neu.length) return;
    [neu[i], neu[ziel]] = [neu[ziel], neu[i]];
    this.aenderung.emit(neu);
  }
}
