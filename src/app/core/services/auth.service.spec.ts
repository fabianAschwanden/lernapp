import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';

import { NurLokal } from '../domain/sync';
import { AuthService, Benutzer, KONTO_SCHLUESSEL, SEITE, nurAngemeldet, sichererZurueckPfad } from './auth.service';
import { setzeKonto } from './api';
import { SpeicherService } from './speicher.service';
import { SyncService } from './sync.service';

class SpeicherAttrappe {
  werte = new Map<string, unknown>();
  ausstehend = 0;
  nurLokalListe: NurLokal[] = [];
  zuletzt: string | null = null;
  konto: string | null = null;
  leereAlles = vi.fn(async () => {
    this.werte.clear();
    this.ausstehend = 0;
    this.nurLokalListe = [];
    this.zuletzt = null;
  });
  allesInAusgang = vi.fn(async () => 0);
  async lies<T>(k: string) {
    return this.werte.get(k) as T | undefined;
  }
  async schreibe(k: string, w: unknown) {
    this.werte.set(k, w);
  }
  async ausgangAnzahl() {
    return this.ausstehend;
  }
  async nurLokal() {
    return this.nurLokalListe;
  }
  async syncZuletzt() {
    return this.zuletzt;
  }
  setzeKonto(k: string | null) {
    this.konto = k;
  }
}

function json(daten: unknown, status = 200): Response {
  return new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });
}

const ANNA: Benutzer = { email: 'anna@example.com', name: 'Anna', konto: 'konto-anna' };
const BEN: Benutzer = { email: 'ben@example.com', name: 'Ben', konto: 'konto-ben' };

/** Ein paar Mikrotasks abwarten (async-Ketten ohne Timer). */
async function ruhe(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('AuthService', () => {
  let speicher: SpeicherAttrappe;
  let sync: Record<
    'start' | 'stop' | 'synchronisieren' | 'diensteGeladen' | 'diensteNeuLaden' | 'letzterLaufOk',
    ReturnType<typeof vi.fn>
  >;
  let seite: { gehe: ReturnType<typeof vi.fn>; neuLaden: ReturnType<typeof vi.fn> };
  let fetchMock: ReturnType<typeof vi.fn>;

  function konfiguriere(s: SpeicherAttrappe = speicher): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SpeicherService, useValue: s },
        { provide: SyncService, useValue: sync },
        { provide: SEITE, useValue: seite },
      ],
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    localStorage.clear();
    setzeKonto(null);
    speicher = new SpeicherAttrappe();
    sync = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
      synchronisieren: vi.fn(async () => undefined),
      diensteGeladen: vi.fn(async () => undefined),
      diensteNeuLaden: vi.fn(async () => undefined),
      letzterLaufOk: vi.fn(() => true),
    };
    seite = { gehe: vi.fn(), neuLaden: vi.fn() };
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    konfiguriere();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setzeKonto(null);
  });

  async function starte(): Promise<AuthService> {
    const auth = TestBed.inject(AuthService);
    expect(auth.zustand()).toBe('pruefe');
    await auth.starte();
    return auth;
  }

  it('200 bei erster Anmeldung: vorhandene Daten in den Ausgang, Konto merken, Sync starten', async () => {
    fetchMock.mockResolvedValueOnce(json(ANNA));
    const auth = await starte();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ich');
    expect(fetchMock.mock.calls[0][1].credentials).toBe('same-origin');
    expect(auth.zustand()).toBe('angemeldet');
    expect(auth.benutzer()).toEqual(ANNA);
    expect(speicher.allesInAusgang).toHaveBeenCalledOnce();
    expect(speicher.leereAlles).not.toHaveBeenCalled();
    expect(speicher.werte.get(KONTO_SCHLUESSEL)).toEqual({ konto: 'konto-anna', email: ANNA.email, name: ANNA.name });
    expect(speicher.konto).toBe('konto-anna');
    expect(sync.start).toHaveBeenCalledOnce();
  });

  it('erste Anmeldung: App erst nach dem ersten Abgleich frei (Guard wartet)', async () => {
    let fertig!: () => void;
    sync.start.mockImplementation(() => new Promise<void>((ok) => (fertig = ok)));
    fetchMock.mockResolvedValueOnce(json(ANNA));
    const auth = TestBed.inject(AuthService);
    let bereit = false;
    void auth.bereit().then(() => (bereit = true));
    await ruhe();
    expect(auth.zustand()).toBe('laedt');
    expect(auth.istDrin()).toBe(false);
    expect(bereit).toBe(false);
    const guard = TestBed.runInInjectionContext(
      () => nurAngemeldet({} as ActivatedRouteSnapshot, { url: '/' } as RouterStateSnapshot) as Promise<boolean | UrlTree>,
    );
    fertig();
    expect(await guard).toBe(true);
    expect(auth.zustand()).toBe('angemeldet');
  });

  it('erster Abgleich fehlgeschlagen: Rückfrage, «Erneut versuchen» bzw. «Trotzdem offline weiter»', async () => {
    sync.letzterLaufOk.mockReturnValueOnce(false).mockReturnValueOnce(true);
    fetchMock.mockResolvedValueOnce(json(ANNA));
    const auth = TestBed.inject(AuthService);
    const bereit = auth.bereit();
    await ruhe();
    expect(auth.zustand()).toBe('ladefehler');
    expect(auth.istDrin()).toBe(false);
    auth.ersterAbgleichWahl('nochmal');
    await bereit;
    expect(sync.synchronisieren).toHaveBeenCalledOnce();
    expect(auth.zustand()).toBe('angemeldet');

    // Zweites Szenario: offline weiter
    TestBed.resetTestingModule();
    konfiguriere(new SpeicherAttrappe());
    sync.letzterLaufOk.mockReturnValue(false);
    fetchMock.mockResolvedValueOnce(json(ANNA));
    const zwei = TestBed.inject(AuthService);
    const bereit2 = zwei.bereit();
    await ruhe();
    expect(zwei.zustand()).toBe('ladefehler');
    zwei.ersterAbgleichWahl('offline');
    await bereit2;
    expect(zwei.zustand()).toBe('offline');
    expect(zwei.istDrin()).toBe(true);
  });

  it('dieselbe Person (alter Marker ohne Konto, Gross-/Kleinschreibung egal): Daten bleiben', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, { email: 'Anna@Example.com ', name: 'Anna' });
    fetchMock.mockResolvedValueOnce(json(ANNA));
    await starte();
    expect(speicher.leereAlles).not.toHaveBeenCalled();
    expect(speicher.allesInAusgang).not.toHaveBeenCalled();
  });

  it('gleiches Konto, aber geänderte Google-Adresse: nichts wird gelöscht', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, { konto: 'konto-anna', email: 'alt@example.com', name: 'Anna' });
    speicher.ausstehend = 2;
    fetchMock.mockResolvedValueOnce(json(ANNA));
    const auth = await starte();
    expect(speicher.leereAlles).not.toHaveBeenCalled();
    expect(auth.zustand()).toBe('angemeldet');
    expect((speicher.werte.get(KONTO_SCHLUESSEL) as Benutzer).email).toBe(ANNA.email);
  });

  it('andere Person als zuletzt (nichts Ausstehendes): lokale Daten zuerst löschen und Dienste neu laden', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, BEN);
    speicher.werte.set('einstellungen', { rundenGroesse: 5 });
    fetchMock.mockResolvedValueOnce(json(ANNA));
    const auth = await starte();
    expect(sync.diensteGeladen).toHaveBeenCalled();
    expect(speicher.leereAlles).toHaveBeenCalledWith();
    expect(sync.diensteNeuLaden).toHaveBeenCalled();
    expect(speicher.allesInAusgang).not.toHaveBeenCalled();
    expect(speicher.werte.get('einstellungen')).toBeUndefined();
    expect(speicher.werte.get(KONTO_SCHLUESSEL)).toEqual({ konto: 'konto-anna', email: ANNA.email, name: ANNA.name });
    expect(auth.zustand()).toBe('angemeldet');
  });

  it('Personenwechsel mit vollem Ausgang: nichts löschen ohne Bestätigung', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, BEN);
    speicher.ausstehend = 4;
    speicher.nurLokalListe = [{ id: 'lektion::x', art: 'lektion', schluessel: 'x', grund: 'zu-gross', geaendertAm: '', titel: 'X' }];
    fetchMock.mockResolvedValueOnce(json(ANNA));
    const auth = TestBed.inject(AuthService);
    const bereit = auth.bereit();
    await ruhe();
    expect(auth.zustand()).toBe('personenwechsel');
    expect(auth.istDrin()).toBe(false);
    expect(auth.wechsel()).toMatchObject({ ausstehend: 4, vorher: { email: BEN.email }, nachher: { email: ANNA.email } });
    expect(speicher.leereAlles).not.toHaveBeenCalled();
    expect(sync.start).not.toHaveBeenCalled();

    auth.personenwechselWahl('verwerfen');
    await bereit;
    expect(speicher.leereAlles).toHaveBeenCalledOnce();
    expect((speicher.werte.get(KONTO_SCHLUESSEL) as Benutzer).konto).toBe('konto-anna');
    expect(seite.neuLaden).toHaveBeenCalledOnce();
  });

  it('Personenwechsel abbrechen: Sitzung der neuen Person beenden, neu anmelden, Daten bleiben', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, BEN);
    speicher.ausstehend = 1;
    fetchMock.mockResolvedValueOnce(json(ANNA)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const auth = TestBed.inject(AuthService);
    const bereit = auth.bereit();
    await ruhe();
    auth.personenwechselWahl('abbrechen');
    await bereit;
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/abmelden');
    expect(seite.gehe).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/auth\/google\/start\?zurueck=/));
    expect(speicher.leereAlles).not.toHaveBeenCalled();
  });

  it('401 ohne frühere Anmeldung → abgemeldet, ohne Sync und ohne Fehlertext', async () => {
    fetchMock.mockResolvedValueOnce(json({ fehler: 'nicht-angemeldet', meldung: '…' }, 401));
    const auth = await starte();
    expect(auth.zustand()).toBe('abgemeldet');
    expect(auth.fehler()).toBeNull();
    expect(sync.start).not.toHaveBeenCalled();
  });

  it('401 mit Konto-Marker beim Kaltstart → abgemeldet mit «abgelaufen», Daten bleiben', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, ANNA);
    fetchMock.mockResolvedValueOnce(json({ fehler: 'nicht-angemeldet', meldung: '…' }, 401));
    const auth = await starte();
    expect(auth.zustand()).toBe('abgemeldet');
    expect(auth.fehler()).toBe('abgelaufen');
    expect(auth.keinNetz()).toBe(false);
    expect(speicher.leereAlles).not.toHaveBeenCalled();
  });

  it('403 nicht-freigegeben → abgemeldet mit Fehlercode', async () => {
    fetchMock.mockResolvedValueOnce(json({ fehler: 'nicht-freigegeben', meldung: '…' }, 403));
    const auth = await starte();
    expect(auth.zustand()).toBe('abgemeldet');
    expect(auth.fehler()).toBe('nicht-freigegeben');
  });

  it('ohne Netz nach früherer Anmeldung → offline mit gemerkter Person', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, ANNA);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const auth = await starte();
    expect(auth.zustand()).toBe('offline');
    expect(auth.istDrin()).toBe(true);
    expect(auth.benutzer()).toEqual(ANNA);
    expect(sync.stop).toHaveBeenCalledWith('offline');
    expect(speicher.konto).toBe('konto-anna');
  });

  it('früher angemeldet und abgeglichen: App sofort frei, Server im Hintergrund, Sync erst nach Antwort', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, ANNA);
    speicher.zuletzt = '2026-10-01T10:00:00.000Z';
    let antworte!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((ok) => (antworte = ok)));
    const auth = await starte();
    expect(auth.zustand()).toBe('vorlaeufig');
    expect(auth.istDrin()).toBe(true);
    expect(auth.benutzer()).toEqual(ANNA);
    expect(sync.start).not.toHaveBeenCalled();
    antworte(json(ANNA));
    await ruhe();
    expect(auth.zustand()).toBe('angemeldet');
    expect(sync.start).toHaveBeenCalledOnce();
  });

  it('vorläufig gestartet, Server meldet eine andere Person: Daten löschen und neu laden', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, BEN);
    speicher.zuletzt = '2026-10-01T10:00:00.000Z';
    fetchMock.mockResolvedValueOnce(json(ANNA));
    const auth = await starte();
    await ruhe();
    expect(speicher.leereAlles).toHaveBeenCalledOnce();
    expect(seite.neuLaden).toHaveBeenCalledOnce();
    expect((speicher.werte.get(KONTO_SCHLUESSEL) as Benutzer).konto).toBe('konto-anna');
    expect(sync.start).not.toHaveBeenCalled();
    expect(auth.zustand()).toBe('vorlaeufig');
  });

  it('ohne Netz und ohne frühere Anmeldung → abgemeldet mit Hinweis «kein Netz»; «Nochmals versuchen»', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const auth = await starte();
    expect(auth.zustand()).toBe('abgemeldet');
    expect(auth.keinNetz()).toBe(true);

    let antworte!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((ok) => (antworte = ok)));
    auth.nochmalsPruefen();
    expect(auth.prueftErneut()).toBe(true);
    expect(auth.zustand()).toBe('abgemeldet'); // kein «pruefe»: Guards greifen nicht ein
    await ruhe();
    antworte(json({ fehler: 'nicht-angemeldet', meldung: '…' }, 401));
    await auth.bereit();
    expect(auth.prueftErneut()).toBe(false);
    expect(auth.keinNetz()).toBe(false);
  });

  it('Serverfehler (502 ohne JSON) nach früherer Anmeldung → offline', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, ANNA);
    fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));
    expect((await starte()).zustand()).toBe('offline');
  });

  it('offline: beim online-Ereignis neu prüfen und bei Erfolg anmelden', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, ANNA);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(json(ANNA));
    const auth = await starte();
    window.dispatchEvent(new Event('online'));
    await auth.bereit();
    expect(auth.zustand()).toBe('angemeldet');
    expect(sync.start).toHaveBeenCalledOnce();
  });

  it('offline, wieder online, Sitzung abgelaufen: Hinweis statt stillem Verschwinden, kein Seitenwechsel', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, ANNA);
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json({ fehler: 'nicht-angemeldet', meldung: '…' }, 401));
    const auth = await starte();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    window.dispatchEvent(new Event('online'));
    await auth.bereit();
    expect(auth.zustand()).toBe('abgelaufen');
    expect(auth.istDrin()).toBe(true);
    expect(auth.fehler()).toBe('abgelaufen');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('offline, wieder online, Freigabe entzogen: zur Anmeldeseite mit Grund', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, ANNA);
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json({ fehler: 'nicht-freigegeben', meldung: '…' }, 401));
    const auth = await starte();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/lektion/x/lernen');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    window.dispatchEvent(new Event('online'));
    await auth.bereit();
    expect(auth.zustand()).toBe('abgemeldet');
    expect(navigate).toHaveBeenCalledWith(['/anmelden'], {
      queryParams: { zurueck: '/lektion/x/lernen', fehler: 'nicht-freigegeben' },
    });
  });

  it('401 im Sync: Zustand «abgelaufen» ohne Navigation; mit «sofort» zur Anmeldeseite', async () => {
    fetchMock.mockResolvedValueOnce(json(ANNA));
    const auth = await starte();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/lektion/x/pruefung');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const beiAbmeldung = sync.start.mock.calls[0][0] as (fehler?: string) => void;
    beiAbmeldung(undefined);
    expect(auth.zustand()).toBe('abgelaufen');
    expect(auth.fehler()).toBe('abgelaufen');
    expect(sync.stop).toHaveBeenCalledWith('ausstehend');
    expect(navigate).not.toHaveBeenCalled();

    auth.abgemeldetErkannt(undefined, { sofort: true });
    expect(auth.zustand()).toBe('abgemeldet');
    expect(navigate).toHaveBeenCalledWith(['/anmelden'], {
      queryParams: { zurueck: '/lektion/x/pruefung', fehler: 'abgelaufen' },
    });
  });

  it('offline: steht die Verbindung beim online-Ereignis noch nicht, kurz danach nochmals prüfen', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    speicher.werte.set(KONTO_SCHLUESSEL, ANNA);
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(ANNA));
    const auth = await starte();
    window.dispatchEvent(new Event('online'));
    await auth.bereit();
    expect(auth.zustand()).toBe('offline');
    await vi.advanceTimersByTimeAsync(3000);
    await auth.bereit();
    expect(auth.zustand()).toBe('angemeldet');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Weitere geplante Prüfung nach 15 s ist angemeldet ein No-op.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('abmelden mit ausstehenden Änderungen fragt zuerst nach', async () => {
    fetchMock.mockResolvedValueOnce(json(ANNA));
    const auth = await starte();
    speicher.ausstehend = 3;
    expect(await auth.abmelden()).toEqual({ ausstehend: 3, nurLokal: [] });
    expect(sync.synchronisieren).toHaveBeenCalled();
    expect(speicher.leereAlles).not.toHaveBeenCalled();
    expect(seite.gehe).not.toHaveBeenCalled();
  });

  it('abmelden mit Daten, die nur auf dem Gerät liegen (leerer Ausgang), fragt ebenfalls nach', async () => {
    fetchMock.mockResolvedValueOnce(json(ANNA));
    const auth = await starte();
    const gross: NurLokal = { id: 'lektion::l', art: 'lektion', schluessel: 'l', grund: 'zu-gross', geaendertAm: '', titel: 'Bilder' };
    speicher.nurLokalListe = [gross];
    expect(await auth.abmelden()).toEqual({ ausstehend: 0, nurLokal: [gross] });
    expect(speicher.leereAlles).not.toHaveBeenCalled();
    expect(await auth.abmelden({ trotzAusstehend: true })).toBeNull();
    expect(speicher.leereAlles).toHaveBeenCalledOnce();
  });

  it('abmelden beendet die Sitzung, löscht alle lokalen Daten und geht zur Anmeldung', async () => {
    fetchMock.mockResolvedValueOnce(json(ANNA)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const auth = await starte();
    expect(await auth.abmelden()).toBeNull();
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/auth/abmelden');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Lernapp']).toBe('1');
    expect(speicher.leereAlles).toHaveBeenCalledWith();
    expect(seite.gehe).toHaveBeenCalledWith('/anmelden');
    expect(localStorage.getItem('lernapp-abmelden-ausstehend')).toBeNull();
  });

  it('auf allen Geräten abmelden: eigener Endpunkt mit Konto-Header; offline nicht möglich', async () => {
    fetchMock.mockResolvedValueOnce(json(ANNA)).mockRejectedValueOnce(new TypeError('offline'));
    const auth = await starte();
    expect(await auth.abmelden({ ueberall: true })).toEqual({ ausstehend: 0, nurLokal: [], fehler: 'offline' });
    expect(speicher.leereAlles).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await auth.abmelden({ ueberall: true })).toBeNull();
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe('/api/auth/abmelden-ueberall');
    expect(init.headers['X-Lernapp-Konto']).toBe('konto-anna');
    expect(fetchMock).toHaveBeenCalledTimes(3); // kein zusätzliches /api/auth/abmelden
    expect(speicher.leereAlles).toHaveBeenCalledOnce();
    expect(seite.gehe).toHaveBeenCalledWith('/anmelden');
  });

  it('offline abgemeldet: Sitzung wird beim nächsten Start beim Server beendet', async () => {
    speicher.werte.set(KONTO_SCHLUESSEL, ANNA);
    fetchMock.mockRejectedValueOnce(new TypeError('offline')).mockRejectedValueOnce(new TypeError('offline'));
    const auth = await starte();
    await auth.abmelden({ trotzAusstehend: true });
    expect(localStorage.getItem('lernapp-abmelden-ausstehend')).toBe('1');

    // Neuer Start (neue Instanz wie nach dem Neuladen)
    TestBed.resetTestingModule();
    konfiguriere(new SpeicherAttrappe());
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const neu = await starte();
    expect(fetchMock.mock.lastCall![0]).toBe('/api/auth/abmelden');
    expect(neu.zustand()).toBe('abgemeldet');
    expect(localStorage.getItem('lernapp-abmelden-ausstehend')).toBeNull();
  });

  it('anderer Tab meldet eine andere Person an: Sync stoppen und neu laden', async () => {
    const kanaele: { onmessage: ((e: MessageEvent) => void) | null; postMessage: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        onmessage: ((e: MessageEvent) => void) | null = null;
        postMessage = vi.fn();
        close = vi.fn();
        constructor() {
          kanaele.push(this);
        }
      },
    );
    fetchMock.mockResolvedValueOnce(json(ANNA));
    await starte();
    const [kanal] = kanaele;
    expect(kanal.postMessage).toHaveBeenCalledWith({ typ: 'angemeldet', konto: 'konto-anna' });
    kanal.onmessage!({ data: { typ: 'angemeldet', konto: 'konto-anna' } } as MessageEvent);
    expect(seite.neuLaden).not.toHaveBeenCalled();
    kanal.onmessage!({ data: { typ: 'angemeldet', konto: 'konto-ben' } } as MessageEvent);
    expect(sync.stop).toHaveBeenCalled();
    expect(seite.neuLaden).toHaveBeenCalledOnce();
    kanal.onmessage!({ data: { typ: 'abmelden' } } as MessageEvent);
    expect(sync.stop).toHaveBeenLastCalledWith('ausstehend');
    expect(seite.neuLaden).toHaveBeenCalledOnce(); // erst nach dem Löschen neu laden
    kanal.onmessage!({ data: { typ: 'abgemeldet' } } as MessageEvent);
    expect(seite.neuLaden).toHaveBeenCalledTimes(2);
  });

  it('anmeldeUrl übergibt nur sichere Rücksprung-Pfade', () => {
    const auth = TestBed.inject(AuthService);
    expect(auth.anmeldeUrl('/lektion/a?modus=lernen')).toBe(
      '/api/auth/google/start?zurueck=%2Flektion%2Fa%3Fmodus%3Dlernen',
    );
    expect(auth.anmeldeUrl('https://boese.example')).toBe('/api/auth/google/start?zurueck=%2F');
  });
});

describe('sichererZurueckPfad', () => {
  it.each([
    ['/lektion/x', '/lektion/x'],
    ['/einstellungen?a=1#b', '/einstellungen?a=1#b'],
    ['//boese.example', '/'],
    ['/\\boese.example', '/'],
    ['https://boese.example', '/'],
    ['lektion', '/'],
    ['/anmelden?zurueck=/x', '/'],
    ['/api/auth/google/start', '/'],
    ['/apis', '/apis'],
    [undefined, '/'],
  ])('%s → %s', (ein, aus) => {
    expect(sichererZurueckPfad(ein)).toBe(aus);
  });
});

describe('nurAngemeldet (Guard)', () => {
  function guard(zustand: string, url: string): Promise<boolean | UrlTree> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            bereit: async () => undefined,
            istDrin: () => ['angemeldet', 'offline', 'vorlaeufig', 'abgelaufen'].includes(zustand),
          },
        },
      ],
    });
    return TestBed.runInInjectionContext(
      () => nurAngemeldet({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot) as Promise<boolean | UrlTree>,
    );
  }

  it('angemeldet, offline oder abgelaufen → weiter', async () => {
    expect(await guard('angemeldet', '/einstellungen')).toBe(true);
    TestBed.resetTestingModule();
    expect(await guard('offline', '/einstellungen')).toBe(true);
    TestBed.resetTestingModule();
    expect(await guard('abgelaufen', '/einstellungen')).toBe(true);
  });

  it('abgemeldet → Anmeldeseite mit Rücksprung', async () => {
    const r = (await guard('abgemeldet', '/lektion/a/lernen?modus=fehler')) as UrlTree;
    expect(r.toString()).toBe('/anmelden?zurueck=%2Flektion%2Fa%2Flernen%3Fmodus%3Dfehler');
  });

  it('abgemeldet auf der Startseite → ohne Rücksprung', async () => {
    const r = (await guard('abgemeldet', '/')) as UrlTree;
    expect(r.toString()).toBe('/anmelden');
  });
});
