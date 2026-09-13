import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../i18n/i18n';

/** O time entra inteiro: ou e-mails de contas, ou nomes de convidado. */
export type InscricaoDeCla =
  { name: string; emails: string[] } | { name: string; display_names: string[] };

/**
 * Inscrição de um time — o clã de quatro do Clã Fronto, a dupla do partner.
 *
 * Dois caminhos que nunca se misturam, e é o servidor que impõe isso: e-mails de
 * contas existentes — e quem envia precisa estar entre eles — ou nomes de
 * convidado, caminho só do organizador. O formulário reflete a regra em vez de
 * tentar adivinhá-la.
 *
 * O tamanho vem de fora, porque quem sabe o formato é o evento. O componente não
 * decide se são dois ou quatro: ele desenha o que lhe disserem, e o servidor
 * cobra o mesmo número do outro lado.
 */
@Component({
  selector: 'app-event-clan-enroll',
  imports: [CommonModule],
  templateUrl: './event-clan-enroll.html',
  styleUrl: './event-clan-enroll.scss',
})
export class EventClanEnrollComponent {
  /** Só o organizador pode inscrever um time de convidados — a regra é do servidor. */
  isOwner = input(false);
  /** Quantos integrantes: 4 no Clã Fronto, 2 no partner. */
  tamanho = input(4);
  carregando = input(false);
  /** Erro vindo do servidor. O de preenchimento é local. */
  erro = input('');

  inscrever = output<InscricaoDeCla>();
  fechar = output<void>();

  i18n = inject(I18nService);

  nome = signal('');
  private valores = signal<Record<'emails' | 'nomes', string[]>>({ emails: [], nomes: [] });
  comoConvidados = signal(false);
  erroDePreenchimento = signal('');

  /**
   * Os campos acompanham o tamanho do time. Ficam num `computed` sobre um sinal
   * de valores para o que a pessoa já digitou não sumir se o tamanho mudar —
   * e para o formulário nunca desenhar quatro caixas num torneio de duplas.
   */
  private caixas(chave: 'emails' | 'nomes') {
    const guardado = this.valores()[chave];
    return Array.from({ length: this.tamanho() }, (_, i) => guardado[i] ?? '');
  }
  emails = computed(() => this.caixas('emails'));
  nomes = computed(() => this.caixas('nomes'));

  private definir(chave: 'emails' | 'nomes', i: number, valor: string) {
    const atual = this.caixas(chave).map((v, k) => (k === i ? valor : v));
    this.valores.update((v) => ({ ...v, [chave]: atual }));
  }

  /** O do servidor tem precedência: é o mais recente e o mais específico. */
  erroLocal = computed(() => this.erro() || this.erroDePreenchimento());

  /**
   * O mesmo formulário serve aos dois formatos, e o que muda é o substantivo:
   * "clã" com quatro, "dupla" com dois. Uma sufixação em vez de dois blocos de
   * template — o layout é idêntico, só as palavras é que não.
   */
  chave(base: string): string {
    return `clan.${base}${this.tamanho() === 2 ? 'Partner' : ''}`;
  }

  definirEmail(i: number, valor: string) {
    this.definir('emails', i, valor);
  }

  definirNome(i: number, valor: string) {
    this.definir('nomes', i, valor);
  }

  enviar() {
    const name = this.nome().trim();
    if (name.length < 2) {
      this.erroDePreenchimento.set(this.i18n.t(this.chave('needName')));
      return;
    }

    const convidados = this.comoConvidados();
    const valores = (convidados ? this.nomes() : this.emails()).map((v) => v.trim());
    if (valores.some((v) => !v)) {
      this.erroDePreenchimento.set(
        this.i18n.t(convidados ? 'clan.needNames' : 'clan.needEmails', { n: this.tamanho() }),
      );
      return;
    }

    this.erroDePreenchimento.set('');
    this.inscrever.emit(convidados ? { name, display_names: valores } : { name, emails: valores });
  }
}
