import { Component, inject, signal, output, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../i18n/i18n';
import { LeagueService, League } from '../../services/league';
import { LayoutEventosService } from '../../services/layout-eventos';

/**
 * A ordem pedida. Vazio é "não pedi nada" — e não é o mesmo que uma ordem.
 *
 * O padrão de uma lista de torneios depende de qual lista é: nos próximos, o
 * mais perto de acontecer primeiro; nos passados, o mais recente. Uma barra de
 * filtros serve as duas seções da home ao mesmo tempo, então ela não tem como
 * mostrar um padrão só — o que ela mostra é a opção de não escolher, que deixa
 * cada seção com o padrão dela (quem decide é o servidor, em lib/listaEventos).
 */
export type OrdemEventos = '' | 'data_desc' | 'data_asc';

export interface FiltroEventos {
  q: string;
  /** Id da liga, `none` para "sem liga", vazio para todas. */
  leagueId: string;
  ordem: OrdemEventos;
}

/**
 * A barra de busca, filtro e ordem das telas que listam torneios.
 *
 * É um componente, e não duas barras parecidas, porque a home e "Meus eventos"
 * mostram a mesma coisa e precisavam oferecer os mesmos controles — foi a
 * divergência entre elas que motivou tanto isto quanto `lib/listaEventos` no
 * servidor. Segue a linha `.filtros` que `avaliacoes` e `admin` já usam: busca,
 * seletores e, aqui, a alternância pôster/lista.
 *
 * Não busca nada sozinha: emite o que foi escolhido e quem a montou refaz a
 * consulta. O texto espera 300 ms depois da última tecla, como na área de
 * usuários — uma requisição por letra digitada é uma por letra apagada também.
 */
@Component({
  selector: 'app-event-filters',
  imports: [CommonModule],
  templateUrl: './event-filters.html',
  styleUrl: './event-filters.scss',
})
export class EventFiltersComponent implements OnInit, OnDestroy {
  i18n = inject(I18nService);
  layout = inject(LayoutEventosService);
  private ligaSvc = inject(LeagueService);

  mudou = output<FiltroEventos>();

  q = signal('');
  leagueId = signal('');
  ordem = signal<OrdemEventos>('');
  ligas = signal<League[]>([]);

  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit() {
    // Só ligas que têm torneio: filtrar por uma liga vazia devolve uma tela
    // vazia, e uma opção que nunca leva a nada é ruído no seletor.
    this.ligaSvc.getLeagues().subscribe({
      next: (ligas) => this.ligas.set(ligas.filter((l) => (l.event_count ?? 0) > 0)),
      // Sem a lista de ligas o seletor fica só com "todas" — a busca e a ordem
      // continuam de pé. Uma barra parcial é melhor que uma tela com erro.
      error: () => this.ligas.set([]),
    });
  }

  ngOnDestroy() {
    // Sem isto, sair da tela antes dos 300 ms dispara uma busca para um
    // componente que já não existe.
    if (this.timer) clearTimeout(this.timer);
  }

  aoBuscar(texto: string) {
    this.q.set(texto);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.emitir(), 300);
  }

  aoEscolherLiga(id: string) {
    this.leagueId.set(id);
    this.emitir();
  }

  aoOrdenar(ordem: string) {
    this.ordem.set(
      (['data_desc', 'data_asc'] as const).includes(ordem as never) ? (ordem as OrdemEventos) : '',
    );
    this.emitir();
  }

  private emitir() {
    this.mudou.emit({ q: this.q(), leagueId: this.leagueId(), ordem: this.ordem() });
  }
}
