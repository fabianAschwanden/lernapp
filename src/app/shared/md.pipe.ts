import { Pipe, PipeTransform } from '@angular/core';

import { miniMarkdown } from '../core/domain/text';

/** Mini-Markdown → HTML für `[innerHTML]` (Text wird vorher escaped). */
@Pipe({ name: 'md' })
export class MdPipe implements PipeTransform {
  transform(text: string | null | undefined): string {
    // Nur Texte: eine beschädigte Lektion (z. B. Zahl statt Text) soll den Bildschirm nicht abstürzen lassen.
    return typeof text === 'string' && text ? miniMarkdown(text) : '';
  }
}
