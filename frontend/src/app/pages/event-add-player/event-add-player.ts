import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../i18n/i18n';

/** O que o organizador preencheu: uma conta pelo e-mail, ou um convidado pelo nome. */
export interface NovoJogador {
  email?: string;
  display_name?: string;
}

/**
 * Inscrever alguém à mão.
 *
 * Dois caminhos que nunca se misturam: o e-mail de uma conta existente, que
 * liga a participação ao histórico da pessoa, ou um nome de convidado, que vive
 * só dentro deste evento. O e-mail vence quando os dois vêm preenchidos —
 * inscrever a conta é sempre melhor que inscrever um homônimo sem perfil.
 */
@Component({
  selector: 'app-event-add-player',
  imports: [CommonModule],
  templateUrl: './event-add-player.html',
  styleUrl: './event-add-player.scss',
})
export class EventAddPlayerComponent {
  /** Erro vindo do servidor: quem fala com ele é o pai. */
  erro = input('');
  carregando = input(false);

  adicionar = output<NovoJogador>();
  fechar = output<void>();

  i18n = inject(I18nService);

  email = signal('');
  nome = signal('');

  podeEnviar = computed(() => !!(this.email().trim() || this.nome().trim()));

  enviar() {
    if (!this.podeEnviar() || this.carregando()) return;
    const email = this.email().trim();
    const nome = this.nome().trim();
    this.adicionar.emit(email ? { email } : { display_name: nome });
  }
}
