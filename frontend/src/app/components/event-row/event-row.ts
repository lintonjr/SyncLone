import { Component, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../i18n/i18n';
import { DataEventoPipe } from '../../lib/data-evento.pipe';

/**
 * O mínimo que uma linha de torneio precisa saber.
 *
 * Não é `TournamentEvent` de propósito: a página da liga lista torneios com um
 * punhado de colunas (`LeagueEvent`), e exigir o evento inteiro obrigaria aquela
 * rota a devolver coisa que a linha não mostra. As duas formas satisfazem esta,
 * e o que falta simplesmente não aparece.
 */
export interface EventoEmLinha {
  id: string;
  name: string;
  date: string;
  timezone?: string;
  game: string;
  format?: string;
  status: string;
  league_name?: string;
  player_count?: number;
}

/**
 * Um torneio em uma linha — a alternativa ao pôster 2:3 do `app-event-card`.
 *
 * A marcação nasceu na página da liga, que lista torneios em linha desde sempre;
 * virou componente quando a home e "Meus eventos" ganharam a opção de lista, para
 * "torneio em linha" ter uma aparência só nas três telas em vez de três parecidas.
 *
 * O pôster vende o torneio: capa grande, uma por tela de celular. A linha serve
 * para achar um entre muitos — é por isso que ela existe, e é por isso que mostra
 * liga e número de inscritos, que o pôster não tem onde pôr.
 */
@Component({
  selector: 'app-event-row',
  imports: [CommonModule, RouterLink, DataEventoPipe],
  templateUrl: './event-row.html',
  styleUrl: './event-row.scss',
})
export class EventRowComponent {
  i18n = inject(I18nService);
  event = input.required<EventoEmLinha>();

  /** A mesma cor por status do pôster: roxo o que vem, amarelo o que corre, verde o que acabou. */
  corDoStatus(): string {
    const s = this.event().status;
    return s === 'upcoming' ? 'badge-purple' : s === 'ongoing' ? 'badge-yellow' : 'badge-green';
  }
}
