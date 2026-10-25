import { Injectable, computed, inject, signal } from '@angular/core';

import { freieId, slug } from '../domain/id';
import { ergaenzeLektion, validiereLektion } from '../domain/lektion-validierung';
import { Lektion, LektionKopf, lektionKopf } from '../models/lektion.model';
import { RueckmeldungService } from './rueckmeldung.service';
import { SpeicherService } from './speicher.service';

/** Verzeichnis der mitgelieferten Lektionen (liegt in `public/lektionen/`). */
interface LektionsIndex {
  lektionen: string[];
}

/**
 * Hält alle Lektionen im Speicher. Mitgelieferte Lektionen kommen als JSON aus
 * `public/lektionen/`, eigene aus IndexedDB. Hat eine eigene Lektion dieselbe id
 * wie eine mitgelieferte (bearbeitete Kopie), gewinnt die eigene.
 */
@Injectable({ providedIn: 'root' })
export class LektionService {
  private readonly speicher = inject(SpeicherService);
  private readonly rueckmeldungen = inject(RueckmeldungService);

  private readonly mitgeliefert = signal<Lektion[]>([]);
  private readonly eigene = signal<Lektion[]>([]);
  readonly geladen = signal(false);
  readonly ladefehler = signal<string | null>(null);

  readonly lektionen = computed<Lektion[]>(() => {
    const eigene = this.eigene();
    const ids = new Set(eigene.map((l) => l.id));
    return [...this.mitgeliefert().filter((l) => !ids.has(l.id)), ...eigene].sort(
      (a, b) => a.fach.localeCompare(b.fach, 'de-CH') || a.titel.localeCompare(b.titel, 'de-CH'),
    );
  });

  readonly koepfe = computed<LektionKopf[]>(() => this.lektionen().map(lektionKopf));

  /** Fächer mit ihren Lektionen, alphabetisch. */
  readonly faecher = computed(() => {
    const map = new Map<string, LektionKopf[]>();
    for (const k of this.koepfe()) map.set(k.fach, [...(map.get(k.fach) ?? []), k]);
    return [...map.entries()].map(([fach, lektionen]) => ({ fach, lektionen }));
  });

  private ladenPromise: Promise<void> | null = null;

  /** Lädt einmalig; weitere Aufrufe warten auf denselben Vorgang. */
  laden(): Promise<void> {
    this.ladenPromise ??= this.ladeIntern();
    return this.ladenPromise;
  }

  private async ladeIntern(): Promise<void> {
    const [mitgeliefert, eigene] = await Promise.all([
      this.ladeMitgelieferte(),
      this.speicher.alleLektionen().catch(() => [] as Lektion[]),
    ]);
    this.mitgeliefert.set(mitgeliefert);
    // Ältere bzw. roh gespeicherte Lektionen um vorausgesetzte Felder ergänzen
    this.eigene.set(eigene.map((l) => ergaenzeLektion(l)));
    this.geladen.set(true);
  }

  private async ladeMitgelieferte(): Promise<Lektion[]> {
    try {
      const index = (await (await fetch('lektionen/index.json')).json()) as LektionsIndex;
      const lektionen = await Promise.all(
        index.lektionen.map(async (datei) => (await (await fetch(`lektionen/${datei}`)).json()) as Lektion),
      );
      return lektionen.filter((l) => {
        const fehler = validiereLektion(l);
        if (fehler.length) console.error(`Lektion ${l?.id} ist ungültig:`, fehler);
        return fehler.length === 0;
      });
    } catch (e) {
      this.ladefehler.set('Die mitgelieferten Lektionen konnten nicht geladen werden.');
      console.error(e);
      return [];
    }
  }

  lektion(id: string): Lektion | undefined {
    return this.lektionen().find((l) => l.id === id);
  }

  istMitgeliefert(id: string): boolean {
    return this.mitgeliefert().some((l) => l.id === id);
  }

  /** true, wenn eine mitgelieferte Lektion lokal überschrieben wurde. */
  istBearbeiteteKopie(id: string): boolean {
    return this.istMitgeliefert(id) && this.eigene().some((l) => l.id === id);
  }

  /**
   * Speichert eine eigene Lektion. `zeitstempelBehalten` für Backups: sonst gälte
   * eine importierte Lektion fälschlich als neuer als die auf dem anderen Gerät.
   */
  async speichern(l: Lektion, opt: { zeitstempelBehalten?: boolean } = {}): Promise<void> {
    const neu: Lektion = opt.zeitstempelBehalten ? { ...l } : { ...l, geaendertAm: new Date().toISOString() };
    await this.speicher.speichereLektion(neu);
    this.eigene.update((liste) => [...liste.filter((x) => x.id !== neu.id), neu]);
  }

  /**
   * Löscht eine eigene Lektion. Bei einer bearbeiteten mitgelieferten Lektion
   * kommt danach wieder das Original zum Vorschein.
   */
  async loeschen(id: string): Promise<void> {
    await this.speicher.loescheLektion(id);
    this.eigene.update((liste) => liste.filter((x) => x.id !== id));
  }

  /**
   * Erzeugt eine freie id aus einem Titel, z. B. «Informatik Prüfung 2» → `informatik-pruefung-2`.
   * Belegt sind die ids der Lektionen und auch die verwaister Rückmeldungen
   * (Lektion gelöscht): Sonst hinge sich die alte Rückmeldung an die neue Lektion.
   */
  freieId(basis: string): string {
    const belegt = new Set([
      ...this.lektionen().map((l) => l.id),
      ...this.rueckmeldungen.alle().map((r) => r.lektionId),
    ]);
    return freieId(slug(basis, 60) || 'lektion', belegt);
  }
}
