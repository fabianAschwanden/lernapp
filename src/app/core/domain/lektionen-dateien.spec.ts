import { validiereLektion } from './lektion-validierung';

/**
 * Prüft alle mitgelieferten Lektionen unter public/lektionen/*.json.
 *
 * Das Projekt hat keine @types/node; die Node-Module werden deshalb zur
 * Laufzeit über einen nicht-literalen Import geladen (Vitest läuft in Node,
 * der Angular-Builder bündelt sie so nicht mit). Der Lauf startet im Projektordner.
 */
interface NodeFs {
  existsSync(pfad: string): boolean;
  readdirSync(pfad: string): string[];
  readFileSync(pfad: string, kodierung: 'utf8'): string;
}

const modulName = (name: string) => `node:${name}`;
const fs = (await import(/* @vite-ignore */ modulName('fs'))) as NodeFs;
const prozess = (globalThis as unknown as { process: { cwd(): string } }).process;
const ordner = `${prozess.cwd()}/public/lektionen`;
const pfad = (datei: string) => `${ordner}/${datei}`;

const dateien: string[] = fs.existsSync(ordner)
  ? fs
      .readdirSync(ordner)
      .filter((d) => d.endsWith('.json') && d !== 'index.json')
      .sort()
  : [];

describe('mitgelieferte Lektionen (public/lektionen)', () => {
  it('findet den Ordner (Node-fs im Testlauf verfügbar)', () => {
    expect(fs.existsSync(ordner)).toBe(true);
  });

  it('index.json listet genau die vorhandenen Lektionen', () => {
    if (!fs.existsSync(pfad('index.json'))) {
      expect(dateien).toEqual([]);
      return;
    }
    const index = JSON.parse(fs.readFileSync(pfad('index.json'), 'utf8')) as { lektionen: string[] };
    expect(Array.isArray(index.lektionen)).toBe(true);
    expect([...index.lektionen].sort()).toEqual(dateien);
  });

  for (const datei of dateien) {
    it(`${datei} ist eine gültige Lektion`, () => {
      const daten = JSON.parse(fs.readFileSync(pfad(datei), 'utf8')) as { id?: string };
      expect(validiereLektion(daten)).toEqual([]);
      expect(daten.id).toBe(datei.replace(/\.json$/, ''));
    });
  }
});
