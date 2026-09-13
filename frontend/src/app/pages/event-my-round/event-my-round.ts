import { Component, computed, input, output, inject } from '@angular/core';
import { I18nService } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { TournamentEvent, Player, Pairing, Round } from '../../services/event';
import { podPlayers, podPlayerResult, roundLabel } from '../event-detail/pod-view';

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

  /** Assento do jogador reportando, mais o resultado escolhido. */
  report = output<{ pairingId: string; result: string }>();

  isPodMode = computed(
    () =>
      (this.ev()?.pod_size ?? 2) >= 3 ||
      ['clafronto', 'partner'].includes(this.ev()?.tournament_format ?? ''),
  );

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
}
