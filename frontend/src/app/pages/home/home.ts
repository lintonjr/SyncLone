import { Component, inject, signal, OnInit } from '@angular/core';
import { I18nService } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EventService, TournamentEvent } from '../../services/event';
import { EventCardComponent } from '../../components/event-card/event-card';

// A API pagina por offset e não devolve total: uma página curta significa fim da
// lista, então "Load more" some sozinho sem precisar de uma contagem extra.
const PAGE_SIZE = 24;

@Component({
  selector: 'app-home',
  imports: [CommonModule, FormsModule, EventCardComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent implements OnInit {
  i18n = inject(I18nService);
  private eventSvc = inject(EventService);
  upcoming = signal<TournamentEvent[]>([]);
  past = signal<TournamentEvent[]>([]);
  loading = signal(true);
  searchQuery = signal('');
  searchTimeout: ReturnType<typeof setTimeout> | null = null;

  moreUpcoming = signal(false);
  morePast = signal(false);
  loadingMore = signal<'upcoming' | 'past' | null>(null);

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.eventSvc.getEvents(this.searchQuery() || undefined, false, 0, PAGE_SIZE).subscribe({
      next: (events) => {
        this.upcoming.set(events);
        this.moreUpcoming.set(events.length === PAGE_SIZE);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.eventSvc.getEvents(this.searchQuery() || undefined, true, 0, PAGE_SIZE).subscribe({
      next: (events) => {
        this.past.set(events);
        this.morePast.set(events.length === PAGE_SIZE);
      },
    });
  }

  loadMore(which: 'upcoming' | 'past') {
    const list = which === 'upcoming' ? this.upcoming : this.past;
    const hasMore = which === 'upcoming' ? this.moreUpcoming : this.morePast;
    this.loadingMore.set(which);
    this.eventSvc
      .getEvents(this.searchQuery() || undefined, which === 'past', list().length, PAGE_SIZE)
      .subscribe({
        next: (events) => {
          list.update((current) => [...current, ...events]);
          hasMore.set(events.length === PAGE_SIZE);
          this.loadingMore.set(null);
        },
        error: () => this.loadingMore.set(null),
      });
  }

  onSearch(q: string) {
    this.searchQuery.set(q);
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => this.load(), 300);
  }
}
