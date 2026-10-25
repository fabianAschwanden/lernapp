import { TestBed } from '@angular/core/testing';

import { EinstellungenService, STANDARD_EINSTELLUNGEN } from './einstellungen.service';
import { SpeicherService } from './speicher.service';

/** Merkt sich, welche Schlüssel geschrieben wurden (nur «einstellungen» geht in den Ausgang). */
class SpeicherAttrappe {
  werte = new Map<string, unknown>();
  geschrieben: { schluessel: string; wert: unknown; opt?: unknown }[] = [];
  async lies<T>(k: string) {
    return this.werte.get(k) as T | undefined;
  }
  async schreibe(schluessel: string, wert: unknown, opt?: unknown) {
    this.werte.set(schluessel, wert);
    this.geschrieben.push({ schluessel, wert, ...(opt && Object.keys(opt).length ? { opt } : {}) });
  }
  async entferne(k: string) {
    this.werte.delete(k);
  }
}

describe('EinstellungenService', () => {
  let speicher: SpeicherAttrappe;

  beforeEach(() => {
    speicher = new SpeicherAttrappe();
    TestBed.configureTestingModule({ providers: [{ provide: SpeicherService, useValue: speicher }] });
  });

  afterEach(() => document.documentElement.removeAttribute('data-theme'));

  it('nur das Farbschema umzustellen schreibt nichts Synchronisiertes (kein Ausgang-Eintrag)', async () => {
    const e = TestBed.inject(EinstellungenService);
    await e.laden();
    await e.aendern({ farbschema: 'dunkel' });
    expect(speicher.geschrieben).toEqual([{ schluessel: 'farbschema', wert: 'dunkel' }]);
    expect(e.werte().farbschema).toBe('dunkel');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('synchronisierte Werte nur bei echter Änderung schreiben, ohne Farbschema', async () => {
    const e = TestBed.inject(EinstellungenService);
    await e.laden();
    await e.aendern({ rundenGroesse: STANDARD_EINSTELLUNGEN.rundenGroesse });
    expect(speicher.geschrieben).toEqual([]);
    await e.aendern({ rundenGroesse: 20, farbschema: 'hell' });
    expect(speicher.geschrieben).toEqual([
      { schluessel: 'farbschema', wert: 'hell' },
      { schluessel: 'einstellungen', wert: { ...STANDARD_EINSTELLUNGEN, farbschema: undefined, rundenGroesse: 20 } },
    ].map((x) => (x.schluessel === 'einstellungen' ? { ...x, wert: ohneFarbschema(x.wert as object) } : x)));
  });

  it('Farbschema aus dem eigenen Schlüssel, früherer Wert im synchronisierten Objekt als Rückfall', async () => {
    speicher.werte.set('einstellungen', { rundenGroesse: 8, farbschema: 'dunkel' });
    const e = TestBed.inject(EinstellungenService);
    await e.laden();
    expect(e.werte()).toMatchObject({ rundenGroesse: 8, farbschema: 'dunkel' });
    speicher.werte.set('farbschema', 'hell');
    await e.neuLaden();
    expect(e.werte().farbschema).toBe('hell');
  });

  it('Backup-Import gibt den Sync-Stempel weiter', async () => {
    const e = TestBed.inject(EinstellungenService);
    await e.laden();
    await e.aendern({ kiModell: 'claude-haiku-5-5' }, { syncStempel: '2000-01-01T00:00:00.000Z' });
    expect(speicher.geschrieben[0]).toMatchObject({ schluessel: 'einstellungen', opt: { syncStempel: '2000-01-01T00:00:00.000Z' } });
  });
});

function ohneFarbschema(o: object): object {
  const { farbschema: _, ...rest } = o as { farbschema?: unknown };
  return rest;
}
