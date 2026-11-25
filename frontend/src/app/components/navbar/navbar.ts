import { Component, computed, signal, inject, HostListener, effect } from '@angular/core';
import { I18nService } from '../../i18n/i18n';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth';
import { ThemeService } from '../../services/theme';
import { NotificationService } from '../../services/notification';
import { NotificationPanelComponent } from '../notification-panel/notification-panel';

/**
 * Um destino da navegação.
 *
 * `exato` existe por causa da home: sem ele, `/` ficaria marcada como ativa em
 * toda rota, porque toda rota começa com barra.
 */
export interface LinkDeNavegacao {
  rota: string;
  /** Chave do dicionário, não a frase — o rótulo muda com o idioma. */
  rotulo: string;
  exato?: boolean;
}

@Component({
  selector: 'app-navbar',
  imports: [RouterLink, RouterLinkActive, CommonModule, NotificationPanelComponent],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss',
})
export class NavbarComponent {
  i18n = inject(I18nService);
  auth = inject(AuthService);
  theme = inject(ThemeService);
  notif = inject(NotificationService);
  showNotifications = signal(false);
  showUserMenu = signal(false);
  showMenu = signal(false);

  /** Admin também organiza — a regra mora no AuthService. */
  podeOrganizar = this.auth.podeOrganizar;

  /**
   * Para onde a navegação leva, conforme o papel de quem olha.
   *
   * É uma lista só porque a barra do desktop e o menu do celular desenham as
   * duas a mesma coisa. Escrita duas vezes no template, o próximo link entraria
   * numa e seria esquecido na outra — foi exatamente assim que Avaliações,
   * Administração, Criar evento e Badges ficaram inalcançáveis no celular: a
   * barra sumia abaixo de 640px e não havia nada no lugar.
   */
  links = computed<LinkDeNavegacao[]>(() => {
    const itens: LinkDeNavegacao[] = [
      { rota: '/', rotulo: 'nav.home', exato: true },
      { rota: '/events', rotulo: 'nav.myEvents' },
      { rota: '/leagues', rotulo: 'nav.leagues' },
    ];
    if (this.podeOrganizar()) {
      itens.push({ rota: '/create', rotulo: 'nav.createEvent' });
      itens.push({ rota: '/badges', rotulo: 'nav.badges' });
    }
    // Avaliar é marca ao lado do papel, não um papel novo: quem atende o balcão
    // costuma estar com o celular na mão, e era o caso mais penalizado.
    if (this.auth.podeAvaliar()) itens.push({ rota: '/avaliacoes', rotulo: 'nav.avaliacoes' });
    if (this.auth.currentUser()?.role === 'admin') {
      itens.push({ rota: '/admin', rotulo: 'nav.admin' });
    }
    return itens;
  });

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

  toggleMenu(event: Event) {
    event.stopPropagation();
    this.showMenu.update((v) => !v);
  }

  closeMenu() {
    this.showMenu.set(false);
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.showUserMenu.set(false);
    this.showNotifications.set(false);
    this.showMenu.set(false);
  }
}
