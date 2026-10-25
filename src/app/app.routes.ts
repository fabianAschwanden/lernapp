import { Route, Routes } from '@angular/router';

import { nurAngemeldet } from './core/services/auth.service';

/** Alle Seiten der App; nur mit Anmeldung (oder offline nach früherer Anmeldung) erreichbar. */
const seiten: Routes = [
  {
    path: '',
    title: 'Lernapp',
    loadComponent: () => import('./features/start/start').then((m) => m.StartSeite),
  },
  {
    path: 'lektion/:id',
    title: 'Lektion',
    loadComponent: () => import('./features/lektion/lektion-uebersicht').then((m) => m.LektionUebersicht),
  },
  {
    // Query-Parameter: modus=lernen|lernziel|fehler, lz=<lernzielId>
    path: 'lektion/:id/lernen',
    title: 'Lernen',
    loadComponent: () => import('./features/lernen/lern-sitzung').then((m) => m.LernSitzung),
  },
  {
    path: 'lektion/:id/pruefung',
    title: 'Probeprüfung',
    loadComponent: () => import('./features/pruefung/probe-pruefung').then((m) => m.ProbePruefung),
    // Inline statt importiertem Guard, damit die Komponente lazy bleibt
    canDeactivate: [(c: { darfVerlassen?: () => boolean }) => c.darfVerlassen?.() ?? true],
  },
  {
    // Query-Parameter: lz=<lernzielId> springt zum Lernziel
    path: 'lektion/:id/lernzettel',
    title: 'Lernzettel',
    loadComponent: () => import('./features/lernzettel/lernzettel').then((m) => m.Lernzettel),
  },
  {
    path: 'lektion/:id/kurzfassung',
    title: 'Kurzfassung',
    loadComponent: () => import('./features/kurzfassung/kurzfassung').then((m) => m.Kurzfassung),
  },
  {
    path: 'lektion/:id/bearbeiten',
    title: 'Lektion bearbeiten',
    loadComponent: () => import('./features/editor/lektion-editor').then((m) => m.LektionEditor),
    canDeactivate: [(c: { kannVerlassen?: () => boolean }) => c.kannVerlassen?.() ?? true],
  },
  {
    path: 'lektion/:id/rueckmeldung',
    title: 'Rückmeldung zur Prüfung',
    loadComponent: () => import('./features/rueckmeldung/rueckmeldung').then((m) => m.RueckmeldungSeite),
    canDeactivate: [(c: { kannVerlassen?: () => boolean }) => c.kannVerlassen?.() ?? true],
  },
  {
    // Query-Parameter: fach=<Profilschlüssel> springt zum Fach
    path: 'rueckmeldungen',
    title: 'Rückmeldungen',
    loadComponent: () => import('./features/rueckmeldungen/rueckmeldungen').then((m) => m.RueckmeldungenSeite),
  },
  {
    path: 'neu',
    title: 'Neue Lektion',
    loadComponent: () => import('./features/material/material-assistent').then((m) => m.MaterialAssistent),
    // Fragt nach, bevor eine laufende KI-Erstellung, Material oder ein ungespeichertes Ergebnis verloren geht
    canDeactivate: [(c: { darfVerlassen?: () => boolean }) => c.darfVerlassen?.() ?? true],
  },
  {
    path: 'einstellungen',
    title: 'Einstellungen',
    loadComponent: () => import('./features/einstellungen/einstellungen').then((m) => m.EinstellungenSeite),
  },
];

export const routes: Routes = [
  {
    // Query-Parameter: zurueck=<Pfad nach der Anmeldung>, fehler=nicht-freigegeben|abgebrochen|fehler
    path: 'anmelden',
    title: 'Anmelden',
    loadComponent: () => import('./features/anmelden/anmelden').then((m) => m.AnmeldenSeite),
  },
  ...seiten.map((r): Route => ({ ...r, canActivate: [nurAngemeldet] })),
  { path: '**', redirectTo: '' },
];
