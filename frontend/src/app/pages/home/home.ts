import { Component, inject, signal, OnInit } from '@angular/core';
import { I18nService } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { EventService, TournamentEvent, RecorteEventos } from '../../services/event';
import { EventListComponent } from '../../components/event-list/event-list';
import { EventFiltersComponent, FiltroEventos } from '../../components/event-filters/event-filters';

// A API pagina por offset e não devolve total: uma página curta significa fim da
// lista, então "Load more" some sozinho sem precisar de uma contagem extra.
const PAGE_SIZE = 24;

@Component({
  selector: 'app-home',
  imports: [CommonModule, EventListComponent, EventFiltersComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent implements OnInit {
  i18n = inject(I18nService);
  private eventSvc = inject(EventService);
  upcoming = signal<TournamentEvent[]>([]);
  past = signal<TournamentEvent[]>([]);
  loading = signal(true);

  // O que a barra de filtros escolheu. Ela já segura o texto por 300 ms, então
  // cada mudança que chega aqui vale uma consulta.
  filtro = signal<FiltroEventos>({ q: '', leagueId: '', ordem: '' });

  moreUpcoming = signal(false);
  morePast = signal(false);
  loadingMore = signal<'upcoming' | 'past' | null>(null);

  ngOnInit() {
    this.load();
  }

  /** Vazio é campo que não vai na query string — e, em `sort`, é o padrão da seção. */
  private recorte(): RecorteEventos {
    const f = this.filtro();
    return {
      q: f.q.trim() || undefined,
      leagueId: f.leagueId || undefined,
      sort: f.ordem || undefined,
    };
  }

  aoFiltrar(f: FiltroEventos) {
    this.filtro.set(f);
    // Recomeça do zero: a próxima página do filtro antigo não tem nada a ver
    // com a lista nova, e `load()` já volta ao offset 0.
    this.load();
  }

  load() {
    this.loading.set(true);
    const recorte = this.recorte();
    this.eventSvc.getEvents(recorte, false, 0, PAGE_SIZE).subscribe({
      next: (events) => {
        this.upcoming.set(events);
        this.moreUpcoming.set(events.length === PAGE_SIZE);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.eventSvc.getEvents(recorte, true, 0, PAGE_SIZE).subscribe({
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
    this.eventSvc.getEvents(this.recorte(), which === 'past', list().length, PAGE_SIZE).subscribe({
      next: (events) => {
        list.update((current) => [...current, ...events]);
        hasMore.set(events.length === PAGE_SIZE);
        this.loadingMore.set(null);
      },
      error: () => this.loadingMore.set(null),
    });
  }
}
