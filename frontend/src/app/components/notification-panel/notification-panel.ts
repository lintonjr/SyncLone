import { Component, inject, output, OnInit } from '@angular/core';
import { I18nService } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { NotificationService, Notification } from '../../services/notification';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-notification-panel',
  imports: [CommonModule],
  templateUrl: './notification-panel.html',
  styleUrl: './notification-panel.scss',
})
export class NotificationPanelComponent implements OnInit {
  i18n = inject(I18nService);

  /**
   * O texto de uma notificação, no idioma de quem lê.
   *
   * As novas trazem código e parâmetros; as antigas trazem a frase montada no
   * servidor, e é ela que aparece enquanto elas durarem — mesmo padrão das
   * mensagens de erro da API, e o que permitiu converter sem apagar nada.
   *
   * O aviso de cronômetro é o único que muda de frase conforme o parâmetro: no
   * mata-mata a fase tem nome ("Semifinals"), na fase suíça é um número.
   */
  texto(n: Notification): string {
    if (!n.code) return n.message ?? '';
    const chave =
      n.code === 'notif.timerStarted' && Number(n.params?.['ehPlayoff'])
        ? 'notif.timerStartedPlayoff'
        : n.code;
    return this.i18n.t(chave, n.params ?? undefined);
  }
  close = output<void>();
  notif = inject(NotificationService);
  auth = inject(AuthService);

  ngOnInit() {
    if (this.auth.isLoggedIn()) {
      this.notif.load().subscribe();
    }
  }

  markAll() {
    this.notif.markAllRead().subscribe();
  }
}
