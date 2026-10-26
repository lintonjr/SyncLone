import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Pairing } from '../../services/event';
import { podPlayers } from '../event-detail/pod-view';
import { I18nService } from '../../i18n/i18n';
import { EMPATES, VITORIAS, OpcaoDePlacar, placarPorAssento, rotuloDoPlacar } from '../../lib/placar';

/** Quem venceu a mesa, e com que placar por games. */
export interface ResultadoEscolhido {
  pairingId: string;
  /** 'player1'..'player4' ou 'draw'. */
  resultado: string;
  /** Games dos assentos 1 e 2, ou null quando o placar não foi registrado. */
  games: { p1: number; p2: number } | null;
}

/**
 * Lançar o resultado de uma mesa.
 *
 * Em duelo, cada botão é um placar E o resultado que ele significa — "Ana 2-1"
 * é uma ação só. É a regra da loja: o placar diz quem venceu, então perguntar as
 * duas coisas em separado seria convidar a resposta contraditória que o servidor
 * teria de recusar. Antes daqui a tela oferecia só 2-0 e 2-1, e nunca placar em
 * empate; agora oferece os cinco (2-0, 2-1, 1-0 de cada lado, 1-1 e 0-0).
 *
 * A linha "sem placar" continua existindo para quem não acompanha games — é o
 * caminho antigo, e é o único em mesa de três ou quatro, onde "2×1" não quer
 * dizer nada e os desempates não saberiam ler.
 */
@Component({
  selector: 'app-event-result',
  imports: [CommonModule],
  templateUrl: './event-result.html',
  styleUrl: './event-result.scss',
})
export class EventResultComponent {
  mesa = input.required<Pairing>();
  isPodMode = input(false);

  lancar = output<ResultadoEscolhido>();
  fechar = output<void>();

  i18n = inject(I18nService);

  readonly vitorias = VITORIAS;
  readonly empates = EMPATES;

  assentos = computed(() => podPlayers(this.mesa()));
  ehDuelo = computed(() => !this.isPodMode() && !!this.mesa().player2_id);
  editando = computed(() => !!this.mesa().result);

  /** O placar já gravado na mesa, para destacar o botão correspondente. */
  placarAtual = computed(() => rotuloDoPlacar(this.mesa().p1_games, this.mesa().p2_games));

  /** Este botão é o que já está gravado? Compara resultado E placar. */
  ehAtual(slot: string, opcao: OpcaoDePlacar): boolean {
    if (this.mesa().result !== slot) return false;
    const games = placarPorAssento(opcao, slot !== 'player2');
    return this.placarAtual() === `${games.p1}-${games.p2}`;
  }

  /** Um placar, com o resultado que ele deriva. */
  escolherComPlacar(slot: string, opcao: OpcaoDePlacar) {
    this.lancar.emit({
      pairingId: this.mesa().id,
      resultado: slot,
      games: placarPorAssento(opcao, slot !== 'player2'),
    });
  }

  /** Resultado sem placar: o caminho de quem não registra games. */
  escolher(resultado: string) {
    this.lancar.emit({ pairingId: this.mesa().id, resultado, games: null });
  }
}
