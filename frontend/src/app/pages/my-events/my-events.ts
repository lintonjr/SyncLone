import { Component, inject, signal, OnInit } from '@angular/core';
import { I18nService } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { EventService, TournamentEvent } from '../../services/event';
import { EventCardComponent } from '../../components/event-card/event-card';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-my-events',
  imports: [CommonModule, RouterLink, EventCardComponent],
  templateUrl: './my-events.html',
  styleUrl: './my-events.scss',
})
export class MyEventsComponent implements OnInit {
  i18n = inject(I18nService);
  private eventSvc = inject(EventService);
  auth = inject(AuthService);
  owned = signal<TournamentEvent[]>([]);
  joined = signal<TournamentEvent[]>([]);
  loading = signal(true);
  activeTab = signal<'owned' | 'joined'>('owned');

  ngOnInit() {
    this.eventSvc.getMyEvents().subscribe({
      next: ({ owned, joined }) => {
        this.owned.set(owned);
        this.joined.set(joined);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
