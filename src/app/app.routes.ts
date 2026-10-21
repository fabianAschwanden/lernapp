import { Routes } from '@angular/router';

export const routes: Routes = [
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
    path: 'lektion/:id/bearbeiten',
    title: 'Lektion bearbeiten',
    loadComponent: () => import('./features/editor/lektion-editor').then((m) => m.LektionEditor),
    canDeactivate: [(c: { kannVerlassen?: () => boolean }) => c.kannVerlassen?.() ?? true],
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
  { path: '**', redirectTo: '' },
];
