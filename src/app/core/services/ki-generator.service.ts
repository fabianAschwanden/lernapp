import { Injectable, computed, inject, signal } from '@angular/core';
import type Anthropic from '@anthropic-ai/sdk';

import { KiAuftrag, InhaltsTeil, baueInhalt, systemPrompt } from '../ki/ki-prompt';
import { LEKTION_SCHEMA } from '../ki/ki-schema';
import { UmwandlungsErgebnis, parseKiJson, wandleKiAntwort } from '../ki/ki-umwandlung';
import { Quelle } from '../models/lektion.model';
import { base64AusDataUrl } from '../util/datei';
import { EinstellungenService } from './einstellungen.service';
import { LektionService } from './lektion.service';
import { Material, MaterialService, seitenbereichText } from './material.service';

/** Höchstzahl Bilder (PDF-Seiten + Fotos) pro Anfrage. */
export const MAX_BILDER = 80;

/**
 * Ausgabe-Obergrenze pro Anfrage: das Maximum der wählbaren Modelle (Opus,
 * Sonnet, Haiku 5.5: 128K). Denk-Tokens zählen mit; gestreamt ist das unproblematisch.
 */
export const MAX_AUSGABE_TOKENS = 128_000;

/**
 * Ab so vielen Fragen (Lernziele × Fragen pro Lernziel) warnt der Assistent:
 * Mit Lernzetteln und Denken kann die Antwort sonst die Obergrenze erreichen.
 */
export const WARNUNG_AB_FRAGEN = 200;

export type KiPhase = 'bereit' | 'vorbereiten' | 'denken' | 'schreiben' | 'fertig' | 'fehler';

export interface KiFortschritt {
  phase: KiPhase;
  /** Lesbarer Text für die Anzeige (aria-live). */
  text: string;
  /** 0..1 während der Vorbereitung, sonst null (unbestimmt). */
  anteil: number | null;
  /** Empfangene JSON-Zeichen. */
  zeichen: number;
  /** Geschätzte Anzahl bereits geschriebener Fragen. */
  fragen: number;
}

/** Fehler mit einer Meldung, die direkt angezeigt werden kann. */
export class KiFehler extends Error {
  constructor(
    meldung: string,
    readonly abgebrochen = false,
  ) {
    super(meldung);
    this.name = 'KiFehler';
  }
}

const BEREIT: KiFortschritt = { phase: 'bereit', text: '', anteil: null, zeichen: 0, fragen: 0 };
const FRAGE_MARKE = '"lernzielId"';

type AnthropicModul = typeof import('@anthropic-ai/sdk');

/**
 * Erstellt mit Claude aus Material und Lernzielen eine Lektion. Läuft direkt
 * im Browser mit dem API-Schlüssel der Person (nur lokal gespeichert).
 */
@Injectable({ providedIn: 'root' })
export class KiGeneratorService {
  private readonly einstellungen = inject(EinstellungenService);
  private readonly lektionen = inject(LektionService);
  private readonly material = inject(MaterialService);

  private readonly _fortschritt = signal<KiFortschritt>(BEREIT);
  readonly fortschritt = this._fortschritt.asReadonly();
  readonly laeuft = computed(() =>
    ['vorbereiten', 'denken', 'schreiben'].includes(this._fortschritt().phase),
  );

  private abbruch: AbortController | null = null;

  /** Zählt die Bilder, die eine Anfrage mit diesem Material enthielte. */
  static anzahlBilder(material: Material[]): number {
    return material.reduce(
      (n, m) => n + (m.art === 'pdf' ? m.seiten.length : m.art === 'foto' ? 1 : 0),
      0,
    );
  }

  abbrechen(): void {
    this.abbruch?.abort();
  }

  zuruecksetzen(): void {
    if (!this.laeuft()) this._fortschritt.set(BEREIT);
  }

  /** Prüft einen API-Schlüssel mit einem kostenlosen Aufruf (Modellliste). */
  async pruefeSchluessel(apiKey: string): Promise<{ ok: true } | { ok: false; meldung: string }> {
    const sdk = await this.ladeSdk();
    try {
      const client = new sdk.default({
        apiKey: apiKey.trim(),
        dangerouslyAllowBrowser: true,
        maxRetries: 0,
      });
      await client.models.list({ limit: 1 });
      return { ok: true };
    } catch (e) {
      return { ok: false, meldung: this.meldung(sdk, e) };
    }
  }

  /**
   * Erstellt eine Lektion. Wirft KiFehler mit verständlicher Meldung.
   * Das Ergebnis ist noch nicht gespeichert.
   */
  async erstelle(auftrag: KiAuftrag, material: Material[]): Promise<UmwandlungsErgebnis> {
    if (this.laeuft()) throw new KiFehler('Es läuft bereits eine Erstellung.');
    const apiKey = await this.einstellungen.apiSchluessel();
    if (!apiKey) throw new KiFehler('Es ist kein API-Schlüssel eingetragen (siehe Einstellungen).');

    const bilder = KiGeneratorService.anzahlBilder(material);
    if (bilder > MAX_BILDER) {
      throw new KiFehler(
        `Bitte weniger Seiten wählen: höchstens ${MAX_BILDER} Bilder pro Anfrage (jetzt ${bilder}).`,
      );
    }
    if (material.length === 0 && auftrag.lernziele.length === 0) {
      throw new KiFehler('Füge Material oder Lernziele hinzu.');
    }

    const abbruch = new AbortController();
    this.abbruch = abbruch;
    this.setze({ phase: 'vorbereiten', text: 'Material wird vorbereitet …', anteil: 0 });
    try {
      const teile = await this.bereiteVor(material, abbruch.signal);
      const sdk = await this.ladeSdk();
      const client = new sdk.default({ apiKey, dangerouslyAllowBrowser: true });

      let text: string;
      try {
        text = await this.frage(sdk, client, baueInhalt(teile, auftrag), true, abbruch.signal);
      } catch (e) {
        // Wird das Schema abgelehnt, einmal ohne Schema mit «nur JSON»-Anweisung wiederholen.
        if (
          e instanceof sdk.BadRequestError &&
          /output_config|schema|json_schema|format/i.test(e.message)
        ) {
          console.warn('Schema abgelehnt, neuer Versuch ohne output_config.format:', e.message);
          text = await this.frage(
            sdk,
            client,
            baueInhalt(teile, auftrag, true),
            false,
            abbruch.signal,
          );
        } else throw e;
      }

      let daten: unknown;
      try {
        daten = parseKiJson(text);
      } catch (e) {
        throw new KiFehler(`Claude hat keine lesbare Lektion geliefert. ${(e as Error).message}`);
      }
      const ergebnis = wandleKiAntwort(daten, {
        idFuer: (t) => this.lektionen.freieId(t),
        fach: auftrag.fach,
        titel: auftrag.titel,
        klasse: auftrag.klasse,
        lehrperson: auftrag.lehrperson,
        pruefungsdatum: auftrag.pruefungsdatum,
        hinweise: auftrag.hinweise,
        quellen: quellenAus(material),
        herkunft: 'ki',
      });
      this.setze({
        phase: 'fertig',
        text: `Fertig: ${ergebnis.lektion?.fragen.length ?? 0} Fragen zu ${ergebnis.lektion?.lernziele.length ?? 0} Lernzielen.`,
        anteil: null,
      });
      return ergebnis;
    } catch (e) {
      const sdk = await this.ladeSdk().catch(() => null);
      const fehler =
        e instanceof KiFehler
          ? e
          : abbruch.signal.aborted
            ? new KiFehler('Erstellung abgebrochen.', true)
            : new KiFehler(sdk ? this.meldung(sdk, e) : 'Die Erstellung ist fehlgeschlagen.');
      this.setze({ phase: 'fehler', text: fehler.message, anteil: null });
      throw fehler;
    } finally {
      if (this.abbruch === abbruch) this.abbruch = null;
    }
  }

  /** Rendert die gewählten PDF-Seiten und sammelt Fotos und Texte. */
  private async bereiteVor(material: Material[], signal: AbortSignal): Promise<InhaltsTeil[]> {
    const teile: InhaltsTeil[] = [];
    const total = Math.max(1, KiGeneratorService.anzahlBilder(material));
    let erledigt = 0;
    for (const m of material) {
      if (signal.aborted) throw new KiFehler('Erstellung abgebrochen.', true);
      if (m.art === 'pdf') {
        teile.push({
          art: 'text',
          text: `Material: PDF «${m.dok.name}», PDF-Seiten ${seitenbereichText(m.seiten)}`,
        });
        for (const s of m.seiten) {
          if (signal.aborted) throw new KiFehler('Erstellung abgebrochen.', true);
          const [bild, text] = await Promise.all([
            this.material.renderSeite(m.dok, s),
            this.material.seitenText(m.dok, s),
          ]);
          teile.push({ art: 'bild', base64: base64AusDataUrl(bild) });
          teile.push({
            art: 'text',
            text: `«${m.dok.name}», Seite ${s} (Text): ${text || '(kein Text erkannt, siehe Bild)'}`,
          });
          erledigt++;
          this.setze({
            text: `Material wird vorbereitet … (Seite ${erledigt} von ${total})`,
            anteil: erledigt / total,
          });
        }
      } else if (m.art === 'foto') {
        teile.push({ art: 'text', text: `Material: Foto «${m.name}»` });
        teile.push({ art: 'bild', base64: base64AusDataUrl(m.dataUrl) });
        erledigt++;
        this.setze({ anteil: erledigt / total });
      } else {
        teile.push({
          art: 'text',
          text: `Material: Text «${m.titel || 'eingefügter Text'}»\n\n${m.text}`,
        });
      }
    }
    return teile;
  }

  /** Ein Aufruf an Claude (gestreamt). Liefert den Antworttext. */
  private async frage(
    sdk: AnthropicModul,
    client: Anthropic,
    inhalt: ReturnType<typeof baueInhalt>,
    mitSchema: boolean,
    signal: AbortSignal,
  ): Promise<string> {
    this.setze({
      phase: 'denken',
      text: 'Claude denkt nach …',
      anteil: null,
      zeichen: 0,
      fragen: 0,
    });
    const stream = client.beta.messages.stream(
      {
        model: this.einstellungen.werte().kiModell,
        max_tokens: MAX_AUSGABE_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: mitSchema
          ? { effort: 'high', format: { type: 'json_schema', schema: LEKTION_SCHEMA } }
          : { effort: 'high' },
        system: systemPrompt(),
        messages: [{ role: 'user', content: inhalt }],
      },
      { signal },
    );

    let zeichen = 0;
    let fragen = 0;
    let rest = '';
    stream.on('streamEvent', (event) => {
      if (event.type !== 'content_block_start') return;
      const typ = event.content_block.type;
      if (typ === 'fallback') {
        // Ein anderes Modell übernimmt und beginnt von vorn.
        zeichen = fragen = 0;
        rest = '';
        this.setze({ phase: 'denken', text: 'Claude denkt nach …', zeichen: 0, fragen: 0 });
      } else if (typ === 'thinking' || typ === 'redacted_thinking') {
        this.setze({ phase: 'denken', text: 'Claude denkt nach …' });
      }
    });
    stream.on('text', (delta) => {
      zeichen += delta.length;
      const puffer = rest + delta;
      fragen += zaehleVorkommen(puffer, FRAGE_MARKE);
      rest = puffer.slice(-(FRAGE_MARKE.length - 1));
      this.setze({
        phase: 'schreiben',
        text: `Lektion wird geschrieben (${fragen} ${fragen === 1 ? 'Frage' : 'Fragen'}) …`,
        zeichen,
        fragen,
      });
    });

    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      throw new KiFehler(
        'Claude hat die Anfrage abgelehnt. Prüfe, ob das Material Unterrichtsstoff enthält, und versuche es mit weniger oder anderem Material.',
      );
    }
    if (msg.stop_reason === 'max_tokens') {
      throw new KiFehler(
        'Die Antwort wurde zu lang — wähle weniger Fragen pro Lernziel oder teile den Stoff auf zwei Lektionen auf.',
      );
    }
    // Nur Text nach dem letzten Modellwechsel (Fallback) gehört zur Antwort.
    const letzterWechsel = msg.content.map((b) => b.type).lastIndexOf('fallback');
    const text = msg.content
      .slice(letzterWechsel + 1)
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');
    if (!text.trim())
      throw new KiFehler('Claude hat keine Antwort geliefert. Versuche es nochmals.');
    return text;
  }

  private meldung(sdk: AnthropicModul, e: unknown): string {
    if (e instanceof KiFehler) return e.message;
    if (e instanceof sdk.APIUserAbortError) return 'Erstellung abgebrochen.';
    if (e instanceof sdk.AuthenticationError)
      return 'API-Schlüssel ungültig. Prüfe ihn in den Einstellungen.';
    if (e instanceof sdk.PermissionDeniedError)
      return 'Der API-Schlüssel hat keine Berechtigung für diese Anfrage (Modell oder Organisation prüfen).';
    if (e instanceof sdk.NotFoundError)
      return 'Das gewählte Modell wurde nicht gefunden. Prüfe das Modell in den Einstellungen.';
    if (e instanceof sdk.RateLimitError)
      return 'Zu viele Anfragen — kurz warten und nochmals versuchen.';
    if (e instanceof sdk.APIConnectionError)
      return 'Keine Verbindung zu Claude. Prüfe die Internetverbindung.';
    if (e instanceof sdk.BadRequestError) {
      if (/credit|balance|billing/i.test(e.message))
        return 'Das API-Guthaben reicht nicht aus (Abrechnung in der Claude Console prüfen).';
      if (/too large|too long|exceed|prompt is too long/i.test(e.message))
        return 'Die Anfrage ist zu gross — bitte weniger Seiten wählen.';
      return `Claude hat die Anfrage nicht angenommen: ${e.message}`;
    }
    if (e instanceof sdk.InternalServerError)
      return 'Claude ist gerade überlastet oder gestört. Bitte später nochmals versuchen.';
    if (e instanceof sdk.APIError) return `Fehler von Claude (${e.status ?? '?'}): ${e.message}`;
    return e instanceof Error ? e.message : 'Unbekannter Fehler.';
  }

  private ladeSdk(): Promise<AnthropicModul> {
    return import('@anthropic-ai/sdk');
  }

  private setze(teil: Partial<KiFortschritt>): void {
    this._fortschritt.update((f) => ({ ...f, ...teil }));
  }
}

/** Zählt nicht überlappende Vorkommen von `nadel` in `text`. */
export function zaehleVorkommen(text: string, nadel: string): number {
  let n = 0;
  for (let i = text.indexOf(nadel); i >= 0; i = text.indexOf(nadel, i + nadel.length)) n++;
  return n;
}

/** Quellenangaben der Lektion aus dem verwendeten Material. */
export function quellenAus(material: Material[]): Quelle[] {
  return material.map((m, i) => {
    const id = `q${i + 1}`;
    if (m.art === 'pdf')
      return { id, titel: m.dok.name, umfang: `PDF-Seiten ${seitenbereichText(m.seiten)}` };
    if (m.art === 'foto') return { id, titel: m.name };
    return { id, titel: m.titel || 'Eingefügter Text' };
  });
}
