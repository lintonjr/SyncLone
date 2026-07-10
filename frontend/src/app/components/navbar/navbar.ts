import { Component, signal, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth';
import { ThemeService } from '../../services/theme';
import { NotificationPanelComponent } from '../notification-panel/notification-panel';

@Component({
  selector: 'app-navbar',
  imports: [RouterLink, RouterLinkActive, CommonModule, NotificationPanelComponent],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss',
})
export class NavbarComponent {
  auth = inject(AuthService);
  theme = inject(ThemeService);
  showNotifications = signal(false);

  toggleNotifications() {
    this.showNotifications.update((v) => !v);
  }
}
