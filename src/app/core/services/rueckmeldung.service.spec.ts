import { TestBed } from '@angular/core/testing';

import { PruefungsRueckmeldung } from '../models/rueckmeldung.model';
import { RueckmeldungService } from './rueckmeldung.service';
import { SpeicherService } from './speicher.service';

function rm(
  lektionId: string,
  fach: string,
  erstelltAm = '2026-10-01T00:00:00.000Z',
): PruefungsRueckmeldung {
  return {
    id: `rm-${lektionId}`,
    lektionId,
    lektionTitel: lektionId,
    fach,
    erstelltAm,
    lernzielePassend: 3,
    stoffAbgefragt: 'meiste',
    schwierigkeit: 0,
    lernziele: [],
    aufgabenarten: [],
    beispielfragen: [],
  };
}

/** Speicher im Arbeitsspeicher statt IndexedDB. */
class SpeicherAttrappe {
  readonly daten = new Map<string, PruefungsRueckmeldung>();
  lesungen = 0;
  async alleRueckmeldungen() {
    this.lesungen++;
    return [...this.daten.values()];
  }
  async speichereRueckmeldung(r: PruefungsRueckmeldung) {
    this.daten.set(r.id, r);
  }
  async loescheRueckmeldung(id: string) {
    this.daten.delete(id);
  }
}

describe('RueckmeldungService', () => {
  let speicher: SpeicherAttrappe;
  let service: RueckmeldungService;

  beforeEach(() => {
    speicher = new SpeicherAttrappe();
    speicher.daten.set('rm-a', rm('a', 'Biologie'));
    TestBed.configureTestingModule({
      providers: [{ provide: SpeicherService, useValue: speicher }],
    });
    service = TestBed.inject(RueckmeldungService);
  });

  it('lädt einmalig', async () => {
    await Promise.all([service.laden(), service.laden()]);
    await service.laden();
    expect(speicher.lesungen).toBe(1);
    expect(service.geladen()).toBe(true);
    expect(service.fuerLektion('a')?.fach).toBe('Biologie');
    expect(service.fuerLektion('x')).toBeUndefined();
  });

  it('speichert mit geaendertAm und hält Profile aktuell', async () => {
    await service.laden();
    await service.speichern(rm('b', 'biologie '));
    expect(speicher.daten.get('rm-b')?.geaendertAm).toBeTruthy();
    expect(service.alle().length).toBe(2);
    expect(service.profile().length).toBe(1);
    expect(service.profilFuerFach('BIOLOGIE')?.anzahl).toBe(2);
    expect(service.profilFuerFach('Chemie')).toBeNull();
  });

  it('behält beim Import den Zeitstempel und ersetzt dieselbe id', async () => {
    await service.laden();
    await service.speichern(rm('a', 'Biologie', '2025-01-01T00:00:00.000Z'), {
      zeitstempelBehalten: true,
    });
    expect(service.alle().length).toBe(1);
    expect(service.fuerLektion('a')).not.toHaveProperty('geaendertAm');
  });

  it('zieht ein geändertes Fach der Lektion nach, ohne Zeitstempel', async () => {
    speicher.daten.set('rm-a', rm('a', 'Bio'));
    await service.laden();
    await service.fachNachziehen('a', 'Biologie');
    expect(service.profilFuerFach('Biologie')?.rueckmeldungen[0].lektionId).toBe('a');
    expect(service.profilFuerFach('Bio')).toBeNull();
    expect(speicher.daten.get('rm-a')?.fach).toBe('Biologie');
    expect(speicher.daten.get('rm-a')).not.toHaveProperty('geaendertAm');
    await service.fachNachziehen('x', 'Chemie'); // ohne Rückmeldung: nichts
    expect(service.alle().length).toBe(1);
  });

  it('löscht', async () => {
    await service.laden();
    await service.loeschen('rm-a');
    expect(service.alle()).toEqual([]);
    expect(speicher.daten.size).toBe(0);
    expect(service.profile()).toEqual([]);
  });
});
