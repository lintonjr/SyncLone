import { Component, signal, inject, HostListener, effect } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth';
import { ThemeService } from '../../services/theme';
import { NotificationService } from '../../services/notification';
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
  notif = inject(NotificationService);
  showNotifications = signal(false);
  showUserMenu = signal(false);

  constructor() {
    // O painel de notificações só é montado quando aberto, então quem carrega a
    // caixa para o badge é a navbar — sem isso ninguém descobre que tem aviso sem
    // clicar no sino. O effect também cobre entrar e sair: a contagem acompanha a
    // conta atual e não sobrevive a um logout.
    effect(() => {
      if (this.auth.currentUser()) this.notif.load().subscribe({ error: () => {} });
      else this.notif.reset();
    });
  }

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
