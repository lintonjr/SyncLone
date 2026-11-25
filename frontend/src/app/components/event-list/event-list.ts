import { Component, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TournamentEvent } from '../../services/event';
import { LayoutEventosService } from '../../services/layout-eventos';
import { EventCardComponent } from '../event-card/event-card';
import { EventRowComponent } from '../event-row/event-row';

/**
 * Uma leva de torneios, do jeito que a pessoa escolheu ver.
 *
 * As duas telas que listam torneios têm quatro lugares onde a leva aparece — as
 * duas seções da home e as duas abas de "Meus eventos" —, e a grade de pôsteres
 * já estava copiada no SCSS das duas. Com dois modos de exibição a cópia
 * dobraria, então a vitrine virou componente: quem lista só diz *quais* torneios,
 * e como eles aparecem é decisão de um arquivo só.
 */
@Component({
  selector: 'app-event-list',
  imports: [CommonModule, EventCardComponent, EventRowComponent],
  templateUrl: './event-list.html',
  styleUrl: './event-list.scss',
})
export class EventListComponent {
  layout = inject(LayoutEventosService);
  events = input.required<TournamentEvent[]>();
}
