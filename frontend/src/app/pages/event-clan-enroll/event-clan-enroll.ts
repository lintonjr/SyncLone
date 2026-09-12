import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../i18n/i18n';

/** O clã entra inteiro: ou quatro e-mails de contas, ou quatro nomes de convidado. */
export type InscricaoDeCla =
  { name: string; emails: string[] } | { name: string; display_names: string[] };

/**
 * Inscrição de um clã no Clã Fronto.
 *
 * Dois caminhos que nunca se misturam, e é o servidor que impõe isso: quatro
 * e-mails de contas existentes — e quem envia precisa estar entre eles — ou
 * quatro nomes de convidado, caminho só do organizador. O formulário reflete a
 * regra em vez de tentar adivinhá-la.
 *
 * A validação de "os quatro preenchidos" mora aqui, onde os campos estão; o pai
 * só recebe o que passou e fala com o servidor.
 */
@Component({
  selector: 'app-event-clan-enroll',
  imports: [CommonModule],
  templateUrl: './event-clan-enroll.html',
  styleUrl: './event-clan-enroll.scss',
})
export class EventClanEnrollComponent {
  /** Só o organizador pode inscrever um clã de convidados — a regra é do servidor. */
  isOwner = input(false);
  carregando = input(false);
  /** Erro vindo do servidor. O de preenchimento é local. */
  erro = input('');

  inscrever = output<InscricaoDeCla>();
  fechar = output<void>();

  i18n = inject(I18nService);

  nome = signal('');
  emails = signal(['', '', '', '']);
  nomes = signal(['', '', '', '']);
  comoConvidados = signal(false);
  erroDePreenchimento = signal('');

  /** O do servidor tem precedência: é o mais recente e o mais específico. */
  erroLocal = computed(() => this.erro() || this.erroDePreenchimento());

  definirEmail(i: number, valor: string) {
    this.emails.update((lista) => lista.map((v, k) => (k === i ? valor : v)));
  }

  definirNome(i: number, valor: string) {
    this.nomes.update((lista) => lista.map((v, k) => (k === i ? valor : v)));
  }

  enviar() {
    const name = this.nome().trim();
    if (name.length < 2) {
      this.erroDePreenchimento.set(this.i18n.t('clan.needName'));
      return;
    }

    const convidados = this.comoConvidados();
    const valores = (convidados ? this.nomes() : this.emails()).map((v) => v.trim());
    if (valores.some((v) => !v)) {
      this.erroDePreenchimento.set(this.i18n.t(convidados ? 'clan.needNames' : 'clan.needEmails'));
      return;
    }

    this.erroDePreenchimento.set('');
    this.inscrever.emit(convidados ? { name, display_names: valores } : { name, emails: valores });
  }
}
