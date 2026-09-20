import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as QRCode from 'qrcode';
import { TournamentEvent } from '../../services/event';
import { I18nService } from '../../i18n/i18n';
import { DataEventoPipe } from '../../lib/data-evento.pipe';

/**
 * O convite do evento: QR code e os atalhos de compartilhar.
 *
 * É o mais autocontido dos modais da tela — não muda nada no servidor, só mostra
 * o evento e o link. O QR nasce aqui, na abertura, porque é a única coisa que
 * ele precisa buscar e ela depende só do endereço.
 */
@Component({
  selector: 'app-event-share',
  imports: [CommonModule, DataEventoPipe],
  templateUrl: './event-share.html',
  styleUrl: './event-share.scss',
})
export class EventShareComponent {
  ev = input.required<TournamentEvent>();
  fechar = output<void>();

  i18n = inject(I18nService);

  qrDataUrl = signal('');
  copiado = signal(false);

  link = computed(() => `${window.location.origin}/event/${this.ev().id}`);

  constructor() {
    queueMicrotask(() => {
      QRCode.toDataURL(this.link(), { width: 220, margin: 2 }).then((url) =>
        this.qrDataUrl.set(url),
      );
    });
  }

  private mensagem() {
    return `${this.ev().name} — ${this.link()}`;
  }

  whatsapp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(this.mensagem())}`, '_blank');
  }

  email() {
    window.location.href = `mailto:?subject=${encodeURIComponent(
      this.ev().name,
    )}&body=${encodeURIComponent(this.mensagem())}`;
  }

  abrirLink() {
    window.open(this.link(), '_blank');
  }

  /** O "copiado!" volta ao normal sozinho: é confirmação, não estado. */
  copiar() {
    navigator.clipboard.writeText(this.link()).then(() => {
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 2000);
    });
  }
}
