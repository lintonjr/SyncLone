import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Pairing } from '../../services/event';
import { podPlayers } from '../event-detail/pod-view';
import { I18nService } from '../../i18n/i18n';

/** Quem venceu a mesa, e com que placar por games. */
export interface ResultadoEscolhido {
  pairingId: string;
  /** 'player1'..'player4' ou 'draw'. */
  resultado: string;
  placar: '' | '2-0' | '2-1';
}

/**
 * Lançar o resultado de uma mesa.
 *
 * O placar por games só aparece em duelo: numa mesa de quatro não existe "2×1",
 * e oferecer a opção convidaria a registrar algo que os desempates não sabem
 * ler. Ele também acompanha o vencedor escolhido — quem marca 2×1 e depois muda
 * de vencedor não quer o placar do anterior.
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

  /** Começa no placar já registrado, se houver: editar não deve zerar o que existe. */
  placar = signal<'' | '2-0' | '2-1'>('');

  assentos = computed(() => podPlayers(this.mesa()));
  ehDuelo = computed(() => !this.isPodMode() && !!this.mesa().player2_id);
  editando = computed(() => !!this.mesa().result);

  constructor() {
    queueMicrotask(() => {
      const p = this.mesa();
      const temPlacar =
        p.p1_games !== null &&
        p.p1_games !== undefined &&
        p.p2_games !== null &&
        p.p2_games !== undefined;
      if (temPlacar) {
        this.placar.set(Math.min(p.p1_games!, p.p2_games!) === 0 ? '2-0' : '2-1');
      }
    });
  }

  escolher(resultado: string) {
    this.lancar.emit({ pairingId: this.mesa().id, resultado, placar: this.placar() });
  }
}
