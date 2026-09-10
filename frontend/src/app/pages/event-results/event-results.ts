import { Component, computed, input, output, inject } from '@angular/core';
import { I18nService } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { TournamentEvent, Pairing, Round } from '../../services/event';
import {
  podPlayers,
  podPlayerResult,
  gameScoreLabel,
  roundLabel,
  resultLabel,
} from '../event-detail/pod-view';

/** Uma rodada com as suas mesas, como o histórico as exibe. */
export type RoundWithPairings = Round & { pairings: Pairing[] };

/**
 * A aba de resultados: o histórico do torneio, rodada a rodada.
 *
 * Compartilha com a aba de pareamentos a forma de desenhar uma mesa — as
 * funções puras vivem em pod-view.ts — mas responde a outra pergunta: o que já
 * aconteceu, e não o que está acontecendo.
 */
@Component({
  selector: 'app-event-results',
  imports: [CommonModule],
  templateUrl: './event-results.html',
  styleUrl: './event-results.scss',
})
export class EventResultsComponent {
  i18n = inject(I18nService);
  ev = input.required<TournamentEvent>();
  isOwner = input(false);
  actionLoading = input(false);
  rounds = input<RoundWithPairings[]>([]);
  swapMode = input(false);
  swapSelected = input<string | null>(null);

  toggleSwap = output<void>();
  selectSwap = output<string>();
  undo = output<void>();
  openResult = output<Pairing>();
  approve = output<string>();

  isPodMode = computed(
    () => (this.ev()?.pod_size ?? 2) >= 3 || this.ev()?.tournament_format === 'clafronto',
  );

  podPlayers = podPlayers;
  podPlayerResult = podPlayerResult;
  gameScoreLabel = gameScoreLabel;
  roundLabel = roundLabel;
  resultLabel = (p: Pairing): string => resultLabel(p, this.isOwner());

  roundsGrouped = () => this.rounds();

  canEditResult(pairing: Pairing, round: Round): boolean {
    if (!pairing.result || pairing.result === 'bye') return false;
    if (!this.isOwner() || this.swapMode()) return false;
    const ev = this.ev();
    if (!ev || ev.status === 'completed') return false;
    return round.round_number === ev.current_round;
  }

  toggleSwapMode() {
    this.toggleSwap.emit();
  }
  selectForSwap(playerId: string) {
    this.selectSwap.emit(playerId);
  }
  undoRound() {
    this.undo.emit();
  }
  openResultModal(p: Pairing) {
    this.openResult.emit(p);
  }
  approveResult(pairingId: string) {
    this.approve.emit(pairingId);
  }
}
