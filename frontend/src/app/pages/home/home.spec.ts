import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HomeComponent } from './home';
import { I18nService } from '../../i18n/i18n';
import { umEvento } from '../../testing/fixtures';

/**
 * A home lista torneios em duas seções e pagina por offset.
 *
 * Os testes cobrem o encontro entre as duas coisas, que é onde mora o defeito
 * fácil: o filtro tem de recomeçar a paginação, e a paginação tem de carregar o
 * filtro. Uma página do filtro antigo emendada na lista nova mostraria torneio
 * que não casa com o que está escrito na busca.
 */
const PAGE_SIZE = 24;

function pedidos(http: HttpTestingController) {
  const todos = http.match((r) => r.url.endsWith('/events'));
  const futuro = todos.find((r) => !r.request.params.has('past'))!;
  const passado = todos.find((r) => r.request.params.get('past') === 'true')!;
  return { todos, futuro, passado };
}

function montar() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(HomeComponent);
  fixture.detectChanges();
  http.expectOne((r) => r.url.endsWith('/leagues')).flush([]);
  return { fixture, http, html: fixture.nativeElement as HTMLElement };
}

/**
 * Responde as duas seções de uma carga.
 *
 * Recebe a dupla já casada, e não o controller: `match` consome os pedidos, e
 * procurá-los de novo devolveria lista vazia.
 */
function responder(p: ReturnType<typeof pedidos>, futuro: unknown[] = [], passado: unknown[] = []) {
  p.futuro.flush(futuro);
  p.passado.flush(passado);
}

/** Uma página cheia, para o "carregar mais" aparecer. */
function paginaCheia() {
  return Array.from({ length: PAGE_SIZE }, (_, i) => umEvento({ id: `f${i}` }));
}

describe('HomeComponent', () => {
  afterEach(() => localStorage.removeItem('eventos_layout'));

  it('pede as duas seções de uma vez, cada uma do seu lado', () => {
    const { http } = montar();
    const p = pedidos(http);

    expect(p.todos.length).toBe(2);
    expect(p.futuro.request.params.get('offset')).toBe('0');
    expect(p.passado.request.params.get('past')).toBe('true');
    // Sem ordem pedida: o padrão de cada seção é decisão do servidor.
    expect(p.futuro.request.params.has('sort')).toBe(false);
    responder(p);
  });

  it('filtrar recomeça a paginação do zero nas duas seções', () => {
    // A segunda página do filtro antigo não tem nada a ver com a lista nova.
    const { fixture, http } = montar();
    responder(pedidos(http), paginaCheia());

    fixture.componentInstance.aoFiltrar({ q: 'commander', leagueId: '', ordem: 'data_desc' });
    fixture.detectChanges();

    const p = pedidos(http);
    expect(p.todos.length).toBe(2);
    for (const req of p.todos) {
      expect(req.request.params.get('offset')).toBe('0');
      expect(req.request.params.get('q')).toBe('commander');
      expect(req.request.params.get('sort')).toBe('data_desc');
    }
    responder(p);
  });

  it('"carregar mais" continua dentro do filtro', () => {
    // Pedir a próxima página sem o filtro traria torneio que não casa com o que
    // está escrito na busca, emendado no fim da lista filtrada.
    const { fixture, http } = montar();
    responder(pedidos(http));

    fixture.componentInstance.aoFiltrar({ q: 'commander', leagueId: 'l1', ordem: '' });
    fixture.detectChanges();
    responder(pedidos(http), paginaCheia());

    fixture.componentInstance.loadMore('upcoming');
    const mais = http.expectOne((r) => r.url.endsWith('/events'));

    expect(mais.request.params.get('offset')).toBe(String(PAGE_SIZE));
    expect(mais.request.params.get('q')).toBe('commander');
    expect(mais.request.params.get('league_id')).toBe('l1');
    mais.flush([]);
  });

  it('a página cheia oferece mais; a curta encerra a lista', () => {
    // A API não devolve total: o fim da lista é uma página que veio curta.
    const { fixture, http } = montar();
    responder(pedidos(http), paginaCheia(), [umEvento({ id: 'p1' })]);
    fixture.detectChanges();

    expect(fixture.componentInstance.moreUpcoming()).toBe(true);
    expect(fixture.componentInstance.morePast()).toBe(false);
  });
});
