import { TestBed } from '@angular/core/testing';

import { AusgangEintrag, NurLokal, SyncArt, SyncDatensatz, syncId } from '../domain/sync';
import { NetzFehler, rufeApi } from './api';
import { EinstellungenService } from './einstellungen.service';
import { FortschrittService } from './fortschritt.service';
import { LektionService } from './lektion.service';
import { RueckmeldungService } from './rueckmeldung.service';
import { SEITE } from './seite';
import { SpeicherService } from './speicher.service';
import {
  FERN_PRUEFSTAND,
  FERN_PRUEFSTAND_TOKEN,
  SyncService,
  fuerServer,
  naechsteVersion,
  pruefeFernDaten,
} from './sync.service';

const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-01T11:00:00.000Z';

/** Speicher im Arbeitsspeicher mit Ausgang und Sync-Version. */
class SpeicherAttrappe {
  ausgangListe: AusgangEintrag[] = [];
  daten = new Map<string, unknown>();
  version = 0;
  angewendet: SyncDatensatz[] = [];
  vergessen: string[] = [];
  gesetzt: { id: string; geaendertAm: string }[] = [];
  nurLokalListe: NurLokal[] = [];
  zuletzt: string | null = null;
  epoche: string | null = null;
  nachholen: number | null = null;
  konto: string | null = null;
  /** Wie der echte Speicher mit `pruefe` filtern (sonst alles übernehmen). */
  pruefen = false;
  allesInAusgang = vi.fn(async (_opt?: { stempelAusStand?: boolean }) => 0);
  aktivesKonto() {
    return this.konto;
  }
  async nurLokal() {
    return [...this.nurLokalListe];
  }
  async merkeNurLokal(liste: NurLokal[]) {
    for (const e of liste) {
      this.nurLokalListe = [...this.nurLokalListe.filter((x) => x.id !== e.id), e];
    }
  }
  async nurLokalVergessen(ids: string[]) {
    this.nurLokalListe = this.nurLokalListe.filter((x) => !ids.includes(x.id));
  }
  async staendeSetzen(liste: { id: string; geaendertAm: string }[]) {
    this.gesetzt.push(...liste);
  }
  async syncZuletzt() {
    return this.zuletzt;
  }
  async setzeSyncZuletzt(iso: string) {
    this.zuletzt = iso;
  }
  async syncEpoche() {
    return this.epoche;
  }
  async setzeSyncEpoche(e: string | null) {
    this.epoche = e;
  }
  async nachholenStand() {
    return this.nachholen;
  }
  async setzeNachholen(n: number | null) {
    this.nachholen = n;
  }
  beobachte() {
    return () => undefined;
  }
  async ausgang() {
    return [...this.ausgangListe];
  }
  async ausgangAnzahl() {
    return this.ausgangListe.length;
  }
  async datenFuer(eintraege: AusgangEintrag[]): Promise<SyncDatensatz[]> {
    return eintraege.map((e) => {
      const wert = e.geloescht ? undefined : this.daten.get(e.id);
      return { art: e.art, schluessel: e.schluessel, daten: wert ?? null, geaendertAm: e.geaendertAm, geloescht: wert === undefined };
    });
  }
  async ausgangErledigt(eintraege: AusgangEintrag[]) {
    this.ausgangListe = this.ausgangListe.filter((a) => !eintraege.some((e) => e.id === a.id && e.geaendertAm === a.geaendertAm));
  }
  async staendeVergessen(ids: string[]) {
    this.vergessen.push(...ids);
  }
  async syncVersion() {
    return this.version;
  }
  async setzeSyncVersion(v: number) {
    this.version = v;
  }
  async wendeFernAn(liste: SyncDatensatz[], pruefe: (d: SyncDatensatz) => unknown) {
    const ok = this.pruefen ? liste.filter((d) => d.geloescht || pruefe(d) !== null) : liste;
    this.angewendet.push(...ok);
    return { arten: new Set<SyncArt>(ok.map((d) => d.art)), ungueltig: liste.length - ok.length };
  }
}

function eintrag(art: SyncArt, schluessel: string, geaendertAm = T1, geloescht = false): AusgangEintrag {
  return { id: syncId(art, schluessel), art, schluessel, geaendertAm, geloescht };
}

function json(daten: unknown, status = 200): Response {
  return new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Aufruf {
  url: string;
  init: RequestInit;
}

describe('SyncService', () => {
  let speicher: SpeicherAttrappe;
  let aufrufe: Aufruf[];
  let antworten: ((a: Aufruf) => Response | Promise<Response>)[];
  let seite: { gehe: ReturnType<typeof vi.fn>; neuLaden: ReturnType<typeof vi.fn> };
  let pruefstand: number;
  const neu = { lektion: vi.fn(), fortschritt: vi.fn(), rueckmeldung: vi.fn(), einstellung: vi.fn() };

  beforeEach(() => {
    speicher = new SpeicherAttrappe();
    aufrufe = [];
    antworten = [];
    seite = { gehe: vi.fn(), neuLaden: vi.fn() };
    pruefstand = FERN_PRUEFSTAND;
    for (const f of Object.values(neu)) f.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const a = { url, init };
      aufrufe.push(a);
      const naechste = antworten.shift();
      if (!naechste) throw new Error(`unerwarteter Aufruf ${url}`);
      return naechste(a);
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: SpeicherService, useValue: speicher },
        { provide: LektionService, useValue: { neuLaden: neu.lektion, laden: async () => undefined } },
        { provide: FortschrittService, useValue: { neuLaden: neu.fortschritt, laden: async () => undefined } },
        { provide: RueckmeldungService, useValue: { neuLaden: neu.rueckmeldung, laden: async () => undefined } },
        { provide: EinstellungenService, useValue: { neuLaden: neu.einstellung, laden: async () => undefined } },
        { provide: SEITE, useValue: seite },
        { provide: FERN_PRUEFSTAND_TOKEN, useFactory: () => pruefstand },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(SyncService).stop();
    vi.unstubAllGlobals();
  });

  async function starte(beiAbmeldung = vi.fn()): Promise<SyncService> {
    const sync = TestBed.inject(SyncService);
    await sync.start(beiAbmeldung);
    return sync;
  }

  it('lädt den Ausgang hoch, holt Änderungen seitenweise und lädt betroffene Dienste neu', async () => {
    speicher.version = 7;
    speicher.zuletzt = T1; // nicht der erste Abgleich (der lädt nach jeder Seite neu)
    speicher.ausgangListe = [eintrag('fortschritt', 'l::f1'), eintrag('lektion', 'weg', T1, true)];
    speicher.daten.set('fortschritt::l::f1', { schluessel: 'l::f1' });
    antworten = [
      () => json({ version: 9, angenommen: 2, abgelehnt: [] }),
      () =>
        json({
          version: 12,
          mehr: true,
          datensaetze: [{ art: 'rueckmeldung', schluessel: 'r1', daten: {}, geaendertAm: T2, geloescht: false, version: 10 }],
        }),
      () => json({ version: 12, mehr: false, datensaetze: [] }),
    ];

    const sync = await starte();

    const [post, hol1, hol2] = aufrufe;
    expect(post.url).toBe('/api/sync');
    expect(post.init.method).toBe('POST');
    expect((post.init.headers as Record<string, string>)['X-Lernapp']).toBe('1');
    expect((post.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(post.init.credentials).toBe('same-origin');
    expect(JSON.parse(post.init.body as string)).toEqual({
      datensaetze: [
        { art: 'fortschritt', schluessel: 'l::f1', daten: { schluessel: 'l::f1' }, geaendertAm: T1, geloescht: false },
        { art: 'lektion', schluessel: 'weg', daten: null, geaendertAm: T1, geloescht: true },
      ],
    });
    expect(hol1.url).toBe('/api/sync?seit=7&limit=500');
    expect((hol1.init.headers as Record<string, string>)['X-Lernapp']).toBeUndefined();
    expect(hol2.url).toBe('/api/sync?seit=10&limit=500');
    expect(speicher.version).toBe(12);
    expect(speicher.ausgangListe).toEqual([]);
    expect(speicher.angewendet.map((d) => d.schluessel)).toEqual(['r1']);
    expect(neu.rueckmeldung).toHaveBeenCalledOnce();
    expect(neu.lektion).not.toHaveBeenCalled();
    expect(sync.status()).toBe('synchron');
    expect(sync.zuletztAm()).not.toBeNull();
  });

  it('ohne Ausgang wird nur geholt', async () => {
    antworten = [() => json({ version: 0, mehr: false, datensaetze: [] })];
    const sync = await starte();
    expect(aufrufe.map((a) => a.init.method)).toEqual(['GET']);
    expect(sync.status()).toBe('synchron');
  });

  it('veraltet ohne mitgelieferten Serverstand: lokalen Stand vergessen und alles ab Version 0 holen', async () => {
    speicher.version = 5;
    speicher.ausgangListe = [eintrag('pruefung', 'p1')];
    speicher.daten.set('pruefung::p1', { id: 'p1' });
    antworten = [
      () => json({ version: 6, angenommen: 0, abgelehnt: [{ art: 'pruefung', schluessel: 'p1', grund: 'veraltet' }] }),
      () => json({ version: 6, mehr: false, datensaetze: [] }),
    ];
    await starte();
    expect(speicher.vergessen).toEqual(['pruefung::p1']);
    expect(aufrufe[1].url).toBe('/api/sync?seit=0&limit=500');
    expect(speicher.ausgangListe).toEqual([]);
  });

  it('veraltet mit mitgeliefertem Serverstand: gezielt übernehmen, kein Vollabgleich', async () => {
    speicher.version = 5;
    speicher.ausgangListe = [eintrag('lektion', 'l1')];
    speicher.daten.set('lektion::l1', { id: 'l1', titel: 'alt' });
    const server = { art: 'lektion', schluessel: 'l1', daten: { id: 'l1', titel: 'neu' }, geaendertAm: T2, geloescht: false, version: 3 };
    antworten = [
      () => json({ version: 6, angenommen: 0, abgelehnt: [{ art: 'lektion', schluessel: 'l1', grund: 'veraltet', datensatz: server }] }),
      () => json({ version: 6, mehr: false, datensaetze: [] }),
    ];
    await starte();
    expect(speicher.vergessen).toEqual(['lektion::l1']);
    expect(speicher.angewendet).toEqual([server]);
    expect(aufrufe[1].url).toBe('/api/sync?seit=5&limit=500');
    expect(neu.lektion).toHaveBeenCalledOnce();
  });

  it('aus anderen Gründen abgelehnt (z. B. zu gross): lokaler Stand bleibt, als «nur lokal» gemerkt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    speicher.version = 5;
    speicher.ausgangListe = [eintrag('lektion', 'l1')];
    speicher.daten.set('lektion::l1', { id: 'l1', titel: 'Zellatmung' });
    antworten = [
      () => json({ version: 5, angenommen: 0, abgelehnt: [{ art: 'lektion', schluessel: 'l1', grund: 'zu-gross' }] }),
      () => json({ version: 5, mehr: false, datensaetze: [] }),
    ];
    const sync = await starte();
    expect(speicher.vergessen).toEqual([]);
    expect(aufrufe[1].url).toBe('/api/sync?seit=5&limit=500');
    expect(speicher.ausgangListe).toEqual([]);
    expect(speicher.nurLokalListe).toEqual([
      { id: 'lektion::l1', art: 'lektion', schluessel: 'l1', grund: 'zu-gross', geaendertAm: T1, titel: 'Zellatmung' },
    ]);
    expect(sync.nurLokal()).toHaveLength(1);
    expect(sync.meldung()).toContain('«Zellatmung»');
    warn.mockRestore();

    // Später erfolgreich hochgeladen: Markierung weg
    speicher.ausgangListe = [eintrag('lektion', 'l1', T2)];
    antworten = [() => json({ version: 6, angenommen: 1, abgelehnt: [] }), () => json({ version: 6, mehr: false, datensaetze: [] })];
    await sync.synchronisieren();
    expect(speicher.nurLokalListe).toEqual([]);
    expect(sync.meldung()).toBeNull();
  });

  it('vom Server korrigierte Zeitstempel werden übernommen', async () => {
    speicher.ausgangListe = [eintrag('lektion', 'l1', '2099-01-01T00:00:00.000Z')];
    speicher.daten.set('lektion::l1', { id: 'l1' });
    antworten = [
      () => json({ version: 1, angenommen: 1, abgelehnt: [], korrigiert: [{ art: 'lektion', schluessel: 'l1', geaendertAm: T2 }] }),
      () => json({ version: 1, mehr: false, datensaetze: [] }),
    ];
    await starte();
    expect(speicher.gesetzt).toEqual([{ id: 'lektion::l1', geaendertAm: T2 }]);
  });

  it('Ausgang-Einträge eines anderen Kontos werden nicht gesendet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    speicher.konto = 'konto-b';
    speicher.ausgangListe = [
      { ...eintrag('fortschritt', 'l::a'), konto: 'konto-a' },
      { ...eintrag('fortschritt', 'l::b'), konto: 'konto-b' },
      eintrag('fortschritt', 'l::alt'),
    ];
    for (const id of ['l::a', 'l::b', 'l::alt']) speicher.daten.set(`fortschritt::${id}`, { schluessel: id });
    antworten = [() => json({ version: 2, angenommen: 2, abgelehnt: [] }), () => json({ version: 2, mehr: false, datensaetze: [] })];
    await starte();
    const gesendet = JSON.parse(aufrufe[0].init.body as string).datensaetze.map((d: SyncDatensatz) => d.schluessel);
    expect(gesendet).toEqual(['l::b', 'l::alt']);
    expect(speicher.ausgangListe).toEqual([]);
    warn.mockRestore();
  });

  it('409 anderes-konto: Abgleich stoppen und Seite neu laden', async () => {
    const beiAbmeldung = vi.fn();
    speicher.ausgangListe = [eintrag('lektion', 'l1')];
    antworten = [() => json({ fehler: 'anderes-konto', meldung: 'anderes Konto' }, 409)];
    const sync = await starte(beiAbmeldung);
    expect(seite.neuLaden).toHaveBeenCalledOnce();
    expect(beiAbmeldung).not.toHaveBeenCalled();
    expect(speicher.ausgangListe).toHaveLength(1);
    await sync.synchronisieren();
    expect(aufrufe).toHaveLength(1);
  });

  it('«Zuletzt synchronisiert» bleibt gespeichert und erscheint ohne Abgleich in einer neuen Instanz', async () => {
    antworten = [() => json({ version: 0, mehr: false, datensaetze: [] })];
    const sync = await starte();
    expect(speicher.zuletzt).not.toBeNull();
    expect(sync.zuletztAm()).toBe(speicher.zuletzt);
    sync.stop();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SpeicherService, useValue: speicher },
        { provide: LektionService, useValue: { neuLaden: neu.lektion, laden: async () => undefined } },
        { provide: FortschrittService, useValue: { neuLaden: neu.fortschritt, laden: async () => undefined } },
        { provide: RueckmeldungService, useValue: { neuLaden: neu.rueckmeldung, laden: async () => undefined } },
        { provide: EinstellungenService, useValue: { neuLaden: neu.einstellung, laden: async () => undefined } },
        { provide: SEITE, useValue: seite },
      ],
    });
    const zwei = TestBed.inject(SyncService);
    await vi.waitFor(() => expect(zwei.zuletztAm()).toBe(speicher.zuletzt));
  });

  it('ungültige Daten vom Server: vormerken, melden; nach App-Update mit höherem Prüfstand alles neu holen', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    speicher.pruefen = true;
    speicher.version = 4;
    const kaputt = { art: 'lektion', schluessel: 'x', daten: { id: 'x', titel: 'neuer Fragetyp' }, geaendertAm: T2, geloescht: false, version: 5 };
    antworten = [() => json({ version: 5, mehr: false, datensaetze: [kaputt] })];
    const sync = await starte();
    expect(speicher.version).toBe(5);
    expect(speicher.nachholen).toBe(FERN_PRUEFSTAND);
    expect(sync.meldung()).toContain('bitte die App aktualisieren');

    // Gleicher Prüfstand: normal weiter ab Version 5
    antworten = [() => json({ version: 5, mehr: false, datensaetze: [] })];
    await sync.synchronisieren();
    expect(aufrufe.at(-1)!.url).toBe('/api/sync?seit=5&limit=500');

    // Neuer Prüfstand (App-Update): einmal ab 0, Marke danach weg
    sync.stop();
    TestBed.resetTestingModule();
    pruefstand = FERN_PRUEFSTAND + 1;
    TestBed.configureTestingModule({
      providers: [
        { provide: SpeicherService, useValue: speicher },
        { provide: LektionService, useValue: { neuLaden: neu.lektion, laden: async () => undefined } },
        { provide: FortschrittService, useValue: { neuLaden: neu.fortschritt, laden: async () => undefined } },
        { provide: RueckmeldungService, useValue: { neuLaden: neu.rueckmeldung, laden: async () => undefined } },
        { provide: EinstellungenService, useValue: { neuLaden: neu.einstellung, laden: async () => undefined } },
        { provide: SEITE, useValue: seite },
        { provide: FERN_PRUEFSTAND_TOKEN, useValue: pruefstand },
      ],
    });
    speicher.pruefen = false;
    antworten = [() => json({ version: 5, mehr: false, datensaetze: [kaputt] })];
    const neueApp = TestBed.inject(SyncService);
    await neueApp.start(vi.fn());
    expect(aufrufe.at(-1)!.url).toBe('/api/sync?seit=0&limit=500');
    expect(speicher.nachholen).toBeNull();
    expect(neueApp.meldung()).toBeNull();
    warn.mockRestore();
  });

  it('Server zurückgesetzt (seit > Server-Version): alles in den Ausgang, ab 0 holen, danach hochladen', async () => {
    speicher.version = 800;
    speicher.epoche = 'aaaa';
    antworten = [
      () => json({ version: 2, epoche: 'aaaa', mehr: false, datensaetze: [], zurueckgesetzt: true }),
      () => json({ version: 2, epoche: 'aaaa', mehr: false, datensaetze: [] }),
      // zweiter Durchgang (nochmal): Ausgang ist in der Attrappe leer → nur holen
      () => json({ version: 2, epoche: 'aaaa', mehr: false, datensaetze: [] }),
    ];
    await starte();
    expect(speicher.allesInAusgang).toHaveBeenCalledWith({ stempelAusStand: true });
    expect(aufrufe.map((a) => a.url)).toEqual([
      '/api/sync?seit=800&limit=500',
      '/api/sync?seit=0&limit=500',
      '/api/sync?seit=2&limit=500',
    ]);
    expect(speicher.version).toBe(2);
  });

  it('andere Epoche (Datenbank wiederhergestellt): ebenfalls vollständig neu abgleichen', async () => {
    speicher.version = 7;
    speicher.epoche = 'alt';
    antworten = [
      () => json({ version: 9, epoche: 'neu', mehr: false, datensaetze: [] }),
      () => json({ version: 9, epoche: 'neu', mehr: false, datensaetze: [] }),
      () => json({ version: 9, epoche: 'neu', mehr: false, datensaetze: [] }),
    ];
    await starte();
    expect(speicher.epoche).toBe('neu');
    expect(speicher.allesInAusgang).toHaveBeenCalledOnce();
    expect(aufrufe[1].url).toBe('/api/sync?seit=0&limit=500');
  });

  it('erste Antwort mit Epoche: nur merken, kein Neuabgleich', async () => {
    speicher.version = 3;
    antworten = [() => json({ version: 3, epoche: 'e1', mehr: false, datensaetze: [] })];
    await starte();
    expect(speicher.epoche).toBe('e1');
    expect(speicher.allesInAusgang).not.toHaveBeenCalled();
  });

  it('nicht erreichbar → offline, der Ausgang bleibt', async () => {
    speicher.ausgangListe = [eintrag('lektion', 'l1')];
    antworten = [() => Promise.reject(new TypeError('Failed to fetch'))];
    const sync = await starte();
    expect(sync.status()).toBe('offline');
    expect(sync.ausstehend()).toBe(1);
    expect(speicher.ausgangListe).toHaveLength(1);
  });

  it('401 → meldet die Abmeldung und hört auf', async () => {
    const beiAbmeldung = vi.fn();
    antworten = [() => json({ fehler: 'nicht-angemeldet', meldung: 'Bitte anmelden' }, 401)];
    const sync = await starte(beiAbmeldung);
    expect(beiAbmeldung).toHaveBeenCalledWith(undefined);
    expect(sync.status()).not.toBe('laeuft');
    // gestoppt: weitere Aufrufe tun nichts
    await sync.synchronisieren();
    expect(aufrufe).toHaveLength(1);
  });

  it('403 nicht-freigegeben → Abmeldung mit Fehlercode', async () => {
    const beiAbmeldung = vi.fn();
    antworten = [() => json({ fehler: 'nicht-freigegeben', meldung: 'nein' }, 403)];
    await starte(beiAbmeldung);
    expect(beiAbmeldung).toHaveBeenCalledWith('nicht-freigegeben');
  });

  it('Serverfehler mit JSON → Status fehler', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    antworten = [() => json({ fehler: 'intern', meldung: 'kaputt' }, 500)];
    const sync = await starte();
    expect(sync.status()).toBe('fehler');
    warn.mockRestore();
  });

  it('HTML statt JSON (keine API hinter /api) → offline', async () => {
    antworten = [() => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } })];
    const sync = await starte();
    expect(sync.status()).toBe('offline');
  });

  it('zu grosse Datensätze bleiben lokal, werden gemerkt und gemeldet', async () => {
    speicher.ausgangListe = [eintrag('lektion', 'riesig')];
    speicher.daten.set('lektion::riesig', { titel: 'Buchseiten', bild: 'x'.repeat(5 * 1024 * 1024 + 10) });
    antworten = [() => json({ version: 0, mehr: false, datensaetze: [] })];
    const sync = await starte();
    expect(aufrufe.map((a) => a.init.method)).toEqual(['GET']);
    expect(speicher.ausgangListe).toEqual([]);
    expect(speicher.nurLokalListe).toMatchObject([{ id: 'lektion::riesig', grund: 'zu-gross', titel: 'Buchseiten' }]);
    expect(sync.meldung()).toBe(
      'Die Lektion «Buchseiten» ist zu gross für die Synchronisation (über 5 MB) und bleibt nur auf diesem Gerät.',
    );
  });
});

describe('pruefeFernDaten', () => {
  const d = (art: SyncArt, schluessel: string, daten: unknown): SyncDatensatz => ({
    art,
    schluessel,
    daten,
    geaendertAm: T1,
    geloescht: false,
  });

  it('Lernstand nur mit passendem Schlüssel und gültigen Werten', () => {
    const f = { lektionId: 'l', frageId: 'f', fach: 2, richtig: 1, falsch: 0, verlauf: ['richtig'], zuletzt: T1 };
    expect(pruefeFernDaten(d('fortschritt', 'l::f', f))).toMatchObject({ schluessel: 'l::f', fach: 2 });
    expect(pruefeFernDaten(d('fortschritt', 'anders', f))).toBeNull();
    expect(pruefeFernDaten(d('fortschritt', 'l::f', { ...f, fach: 99 }))).toBeNull();
  });

  it('ungültige Lektion wird abgelehnt', () => {
    expect(pruefeFernDaten(d('lektion', 'x', { id: 'x', titel: 'unvollständig' }))).toBeNull();
    expect(pruefeFernDaten(d('lektion', 'x', 'kein Objekt'))).toBeNull();
  });

  it('Einstellungen: nur bekannte Werte, ohne Farbschema, nur Schlüssel «einstellungen»', () => {
    expect(
      pruefeFernDaten(d('einstellung', 'einstellungen', { rundenGroesse: 10, farbschema: 'dunkel', boese: 1 })),
    ).toEqual({ rundenGroesse: 10 });
    expect(pruefeFernDaten(d('einstellung', 'anthropicApiKey', { rundenGroesse: 10 }))).toBeNull();
  });
});

describe('fuerServer', () => {
  it('entfernt gerätebezogene Einstellungen', () => {
    const e: SyncDatensatz = {
      art: 'einstellung',
      schluessel: 'einstellungen',
      daten: { kiModell: 'claude-opus-5-5', farbschema: 'hell' },
      geaendertAm: T1,
      geloescht: false,
    };
    expect(fuerServer(e).daten).toEqual({ kiModell: 'claude-opus-5-5' });
  });
});

describe('naechsteVersion', () => {
  it('letzte Seite: Version der Antwort', () => {
    expect(naechsteVersion({ version: 9, mehr: false, datensaetze: [] }, 3)).toBe(9);
  });
  it('weitere Seiten: höchste Datensatz-Version, sonst Version der Antwort', () => {
    const datensatz = (version?: number): SyncDatensatz => ({
      art: 'lektion',
      schluessel: 'x',
      daten: null,
      geaendertAm: T1,
      geloescht: true,
      version,
    });
    expect(naechsteVersion({ version: 20, mehr: true, datensaetze: [datensatz(4), datensatz(6)] }, 3)).toBe(6);
    expect(naechsteVersion({ version: 20, mehr: true, datensaetze: [datensatz()] }, 3)).toBe(20);
  });
});

describe('rufeApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Abbruch beim Lesen der Antwort (Zeitlimit) gilt als Netzfehler', async () => {
    const antwort = new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    vi.spyOn(antwort, 'text').mockRejectedValue(new DOMException('Zeit abgelaufen', 'TimeoutError'));
    vi.stubGlobal('fetch', async () => antwort);
    await expect(rufeApi('/api/sync?seit=0')).rejects.toBeInstanceOf(NetzFehler);
  });

  it('kaputtes JSON bei 200 ergibt null (kein Netzfehler)', async () => {
    vi.stubGlobal('fetch', async () => new Response('{kaputt', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(rufeApi('/api/ich')).resolves.toBeNull();
  });
});
