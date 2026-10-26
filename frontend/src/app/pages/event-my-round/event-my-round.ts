import { Component, computed, input, output, inject } from '@angular/core';
import { I18nService } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { TournamentEvent, Player, Pairing, Round } from '../../services/event';
import { podPlayers, podPlayerResult, roundLabel } from '../event-detail/pod-view';
import { EMPATES, VITORIAS, OpcaoDePlacar, placarPorAssento } from '../../lib/placar';

/** O que o jogador logado tem pela frente na rodada corrente. */
export interface MyRound {
  round: Round;
  pairing: Pairing;
  myPlayer: Player;
}

/** Estado do cronômetro, calculado pelo pai a partir da rodada corrente. */
export interface RoundTimer {
  waiting: boolean;
  over: boolean;
  warning: boolean;
  label: string;
}

/**
 * A aba "Minha Rodada": a mesa do jogador logado e o botão de reportar.
 *
 * É a única tela do sistema escrita para quem joga, não para quem organiza — e
 * por isso vale tê-la isolada: o que ela mostra depende do usuário da sessão,
 * não do papel de dono do evento.
 */
@Component({
  selector: 'app-event-my-round',
  imports: [CommonModule],
  templateUrl: './event-my-round.html',
  styleUrl: './event-my-round.scss',
})
export class EventMyRoundComponent {
  i18n = inject(I18nService);
  ev = input.required<TournamentEvent>();
  mr = input<MyRound | null>(null);
  timer = input<RoundTimer | null>(null);

  /**
   * Assento do jogador reportando, o resultado escolhido e, em duelo, o placar.
   *
   * O placar é opcional: quem não acompanha games continua tendo os três botões
   * de sempre. Quando vem, é ele que diz o resultado — a mesma regra do
   * organizador, conferida no servidor por `lib/placar.js`.
   */
  report = output<{ pairingId: string; result: string; games?: { p1: number; p2: number } }>();

  isPodMode = computed(
    () =>
      (this.ev()?.pod_size ?? 2) >= 3 ||
      ['clafronto', 'partner'].includes(this.ev()?.tournament_format ?? ''),
  );

  readonly vitorias = VITORIAS;
  readonly empates = EMPATES;

  /** Placar por games só existe em mesa de dois. */
  ehDuelo = computed(() => !this.isPodMode() && !!this.mr()?.pairing.player2_id);

  podPlayers = podPlayers;
  podPlayerResult = podPlayerResult;
  roundLabel = roundLabel;

  roundTimer = () => this.timer();

  mySlot(): string | null {
    const mr = this.mr();
    if (!mr) return null;
    return podPlayers(mr.pairing).find((p) => p.id === mr.myPlayer.id)?.slot ?? null;
  }

  opponentSlot(): string | null {
    const slot = this.mySlot();
    if (slot === 'player1') return 'player2';
    if (slot === 'player2') return 'player1';
    return null;
  }

  reportar(pairingId: string, result: string) {
    this.report.emit({ pairingId, result });
  }

  /** Um placar, com o resultado que ele deriva. */
  reportarComPlacar(slot: string, opcao: OpcaoDePlacar) {
    const mr = this.mr();
    if (!mr) return;
    this.report.emit({
      pairingId: mr.pairing.id,
      result: slot,
      games: placarPorAssento(opcao, slot !== 'player2'),
    });
  }
}
