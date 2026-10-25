import { TestBed } from '@angular/core/testing';

import { PruefungsRueckmeldung } from '../models/rueckmeldung.model';
import { LektionService } from './lektion.service';
import { RueckmeldungService } from './rueckmeldung.service';
import { SpeicherService } from './speicher.service';

/** Speicher ohne Lektionen, mit einer verwaisten Rückmeldung. */
class SpeicherAttrappe {
  async alleLektionen() {
    return [];
  }
  async alleRueckmeldungen(): Promise<PruefungsRueckmeldung[]> {
    return [
      {
        id: 'rm-mathe-pruefung-2',
        lektionId: 'mathe-pruefung-2',
        lektionTitel: 'Mathe Prüfung 2',
        fach: 'Mathematik',
        erstelltAm: '2026-10-01T00:00:00.000Z',
        lernziele: [],
        aufgabenarten: [],
        beispielfragen: [],
      },
    ];
  }
}

describe('LektionService.freieId', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ lektionen: [] })));
    TestBed.configureTestingModule({
      providers: [{ provide: SpeicherService, useValue: new SpeicherAttrappe() }],
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('zählt die ids verwaister Rückmeldungen als belegt', async () => {
    const service = TestBed.inject(LektionService);
    await Promise.all([service.laden(), TestBed.inject(RueckmeldungService).laden()]);
    expect(service.lektion('mathe-pruefung-2')).toBeUndefined();
    expect(service.freieId('Mathe Prüfung 2')).toBe('mathe-pruefung-2-2');
    expect(service.freieId('Mathe Prüfung 3')).toBe('mathe-pruefung-3');
  });
});
