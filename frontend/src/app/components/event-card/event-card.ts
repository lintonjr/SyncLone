import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TournamentEvent } from '../../services/event';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-event-card',
  imports: [CommonModule, RouterLink],
  templateUrl: './event-card.html',
  styleUrl: './event-card.scss',
})
export class EventCardComponent {
  event = input.required<TournamentEvent>();
  apiUrl = environment.apiUrl.replace('/api', '');

  thumbnailUrl(): string {
    const t = this.event().thumbnail;
    return t ? `${this.apiUrl}${t}` : '';
  }

  statusBadge(): string {
    const map: Record<string, string> = {
      upcoming: 'badge badge-purple',
      ongoing: 'badge badge-yellow',
      finished: 'badge badge-green',
    };
    return map[this.event().status] ?? 'badge badge-purple';
  }
}
