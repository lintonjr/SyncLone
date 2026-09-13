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
import { RoundTimer } from '../event-my-round/event-my-round';

/** A rodada corrente e as suas mesas. */
export interface CurrentRound {
  round: Round;
  pairings: Pairing[];
}

/**
 * A aba de pareamentos: a rodada que está em jogo agora, com o cronômetro, a
 * troca de assentos e o botão de desfazer.
 *
 * Diferente da aba de resultados, que olha o histórico inteiro, esta mostra só
 * a rodada corrente — é a tela que fica projetada no salão enquanto se joga.
 */
@Component({
  selector: 'app-event-pairings',
  imports: [CommonModule],
  templateUrl: './event-pairings.html',
  styleUrl: './event-pairings.scss',
})
export class EventPairingsComponent {
  i18n = inject(I18nService);
  ev = input.required<TournamentEvent>();
  isOwner = input(false);
  actionLoading = input(false);
  current = input<CurrentRound | null>(null);
  timer = input<RoundTimer | null>(null);
  swapMode = input(false);
  swapSelected = input<string | null>(null);

  startTimer = output<void>();
  toggleSwap = output<void>();
  selectSwap = output<string>();
  undo = output<void>();
  openResult = output<Pairing>();
  approve = output<string>();

  isPodMode = computed(() => (this.ev()?.pod_size ?? 2) >= 3 || this.isTeamFormat());
  isClanFormat = computed(() => this.ev()?.tournament_format === 'clafronto');
  isPartnerFormat = computed(() => this.ev()?.tournament_format === 'partner');
  /** Clã Fronto e partner: inscrição por time, mesa de quatro, tabela por time. */
  isTeamFormat = computed(() => this.isClanFormat() || this.isPartnerFormat());

  private clanNameByPlayer = computed(() => {
    const nomes = new Map((this.ev()?.clans ?? []).map((c) => [c.id, c.name]));
    const porJogador = new Map<string, string>();
    for (const p of this.ev()?.players ?? []) {
      if (p.clan_id) porJogador.set(p.id, nomes.get(p.clan_id) ?? '');
    }
    return porJogador;
  });

  clanOf(playerId: string | undefined | null): string {
    return playerId ? (this.clanNameByPlayer().get(playerId) ?? '') : '';
  }

  clanIndex(playerId: string | undefined | null): number {
    const clans = this.ev()?.clans ?? [];
    const player = (this.ev()?.players ?? []).find((p) => p.id === playerId);
    const i = clans.findIndex((c) => c.id === player?.clan_id);
    return i < 0 ? 0 : i % 8;
  }

  podPlayers = podPlayers;
  podPlayerResult = podPlayerResult;
  gameScoreLabel = gameScoreLabel;
  roundLabel = roundLabel;
  resultLabel = (p: Pairing): string => resultLabel(p, this.isOwner());

  currentRoundPairings = () => this.current();
  roundTimer = () => this.timer();

  /** Só o dono edita, e nunca durante uma troca de assentos ou com o evento fechado. */
  canEditResult(pairing: Pairing, round: Round): boolean {
    if (!pairing.result || pairing.result === 'bye') return false;
    if (!this.isOwner() || this.swapMode()) return false;
    const ev = this.ev();
    if (!ev || ev.status === 'completed') return false;
    return round.round_number === ev.current_round;
  }

  startRoundTimer() {
    this.startTimer.emit();
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
