import { Component, signal, inject, HostListener } from '@angular/core';
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
  showUserMenu = signal(false);

  toggleNotifications() {
    this.showNotifications.update((v) => !v);
  }

  toggleUserMenu(event: Event) {
    event.stopPropagation();
    this.showUserMenu.update((v) => !v);
  }

  closeUserMenu() {
    this.showUserMenu.set(false);
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.showUserMenu.set(false);
    this.showNotifications.set(false);
  }
}
