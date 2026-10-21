import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { InstallationService } from './core/services/installation.service';
import { UpdateService } from './core/services/update.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly update = inject(UpdateService);

  constructor() {
    // Früh erzeugen, damit «beforeinstallprompt» nicht verpasst wird
    inject(InstallationService);
  }
}
