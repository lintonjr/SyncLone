import { Component, inject, signal, OnInit } from '@angular/core';
import { I18nService } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { EventService, TournamentEvent, RecorteEventos } from '../../services/event';
import { EventListComponent } from '../../components/event-list/event-list';
import { EventFiltersComponent, FiltroEventos } from '../../components/event-filters/event-filters';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-my-events',
  imports: [CommonModule, RouterLink, EventListComponent, EventFiltersComponent],
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

  filtro = signal<FiltroEventos>({ q: '', leagueId: '', ordem: '' });
  /** Um filtro está em pé: é o que explica uma aba vazia para quem tem torneios. */
  filtrando = signal(false);

  ngOnInit() {
    this.carregar();
  }

  aoFiltrar(f: FiltroEventos) {
    this.filtro.set(f);
    this.filtrando.set(!!(f.q.trim() || f.leagueId));
    this.carregar();
  }

  carregar() {
    this.loading.set(true);
    const f = this.filtro();
    const recorte: RecorteEventos = {
      q: f.q.trim() || undefined,
      leagueId: f.leagueId || undefined,
      sort: f.ordem || undefined,
    };
    this.eventSvc.getMyEvents(recorte).subscribe({
      next: ({ owned, joined }) => {
        this.owned.set(owned);
        this.joined.set(joined);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
