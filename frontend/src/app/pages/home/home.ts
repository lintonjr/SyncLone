import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EventService, TournamentEvent } from '../../services/event';
import { EventCardComponent } from '../../components/event-card/event-card';

@Component({
  selector: 'app-home',
  imports: [CommonModule, FormsModule, EventCardComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent implements OnInit {
  private eventSvc = inject(EventService);
  upcoming = signal<TournamentEvent[]>([]);
  past = signal<TournamentEvent[]>([]);
  loading = signal(true);
  searchQuery = signal('');
  searchTimeout: ReturnType<typeof setTimeout> | null = null;

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.eventSvc.getEvents(this.searchQuery() || undefined, false).subscribe({
      next: (events) => { this.upcoming.set(events); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.eventSvc.getEvents(this.searchQuery() || undefined, true).subscribe({
      next: (events) => this.past.set(events),
    });
  }

  onSearch(q: string) {
    this.searchQuery.set(q);
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => this.load(), 300);
  }
}
