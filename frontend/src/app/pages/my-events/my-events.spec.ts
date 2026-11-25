import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MyEventsComponent } from './my-events';
import { AuthService } from '../../services/auth';
import { LayoutEventosService } from '../../services/layout-eventos';
import { I18nService } from '../../i18n/i18n';
import { environment } from '../../../environments/environment';
import { umEvento } from '../../testing/fixtures';

/**
 * "Meus eventos" ganhou os mesmos controles da home.
 *
 * Os testes cobrem o que isso trouxe de novo para esta tela: o recorte indo para
 * o servidor (é lá que a busca sabe achar por nome de jogador), e a aba vazia
 * sabendo a diferença entre "você não tem torneios" e "o filtro não achou nada".
 */
function montar({ owned = [] as unknown[], joined = [] as unknown[], organizador = true } = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  TestBed.inject(AuthService).currentUser.set({
    id: 'eu',
    display_name: 'Eu',
    email: 'eu@t.local',
    role: organizador ? 'organizer' : 'player',
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(MyEventsComponent);
  fixture.detectChanges();

  // A barra de filtros carrega as ligas; a tela, os torneios.
  http.expectOne((r) => r.url.endsWith('/leagues')).flush([]);
  const pedido = http.expectOne((r) => r.url.endsWith('/events/user/mine'));
  pedido.flush({ owned, joined });
  fixture.detectChanges();
  return { fixture, http, pedido, html: fixture.nativeElement as HTMLElement };
}

/** Manda um filtro pela barra, como se a pessoa tivesse digitado e escolhido. */
function filtrar(
  fixture: { componentInstance: MyEventsComponent; detectChanges: () => void },
  filtro: { q?: string; leagueId?: string; ordem?: '' | 'data_desc' | 'data_asc' },
) {
  fixture.componentInstance.aoFiltrar({
    q: filtro.q ?? '',
    leagueId: filtro.leagueId ?? '',
    ordem: filtro.ordem ?? '',
  });
  fixture.detectChanges();
}

describe('MyEventsComponent', () => {
  afterEach(() => localStorage.removeItem('eventos_layout'));

  it('o recorte vai para o servidor, não é peneirado na tela', () => {
    // É o servidor que sabe achar torneio pelo nome de quem jogou nele: o que a
    // tela recebeu não tem os jogadores para peneirar.
    const { fixture, http } = montar({ owned: [umEvento()] });

    filtrar(fixture, { q: 'Zé', leagueId: 'l1', ordem: 'data_asc' });

    const req = http.expectOne((r) => r.url.endsWith('/events/user/mine'));
    expect(req.request.params.get('q')).toBe('Zé');
    expect(req.request.params.get('league_id')).toBe('l1');
    expect(req.request.params.get('sort')).toBe('data_asc');
    req.flush({ owned: [], joined: [] });
  });

  it('sem filtro, nada de vazio vai na query string', () => {
    // `sort` ausente é o que deixa o padrão de cada lista com o servidor.
    const { pedido } = montar();

    expect(pedido.request.params.has('q')).toBe(false);
    expect(pedido.request.params.has('league_id')).toBe(false);
    expect(pedido.request.params.has('sort')).toBe(false);
  });

  it('aba vazia com filtro em pé não oferece "crie o seu primeiro"', () => {
    // Oferecer isso a quem tem dez torneios e filtrou por um nome que não existe
    // seria a tela mentindo sobre o que a pessoa tem.
    const { fixture, http, html } = montar({ owned: [umEvento()] });

    filtrar(fixture, { q: 'torneio que não existe' });
    http.expectOne((r) => r.url.endsWith('/events/user/mine')).flush({ owned: [], joined: [] });
    fixture.detectChanges();

    expect(html.textContent).toContain('Nenhum torneio encontrado com esse filtro.');
    expect(html.textContent).not.toContain('Criar o seu primeiro evento');
  });

  it('aba vazia sem filtro continua convidando a criar o primeiro', () => {
    const { html } = montar({ owned: [] });

    expect(html.textContent).toContain('Você ainda não criou nenhum evento.');
    expect(html.textContent).toContain('Criar o seu primeiro evento');
  });

  it('a contagem das abas acompanha o que está na tela', () => {
    // Com o filtro no servidor, a aba conta o que casou. "Organizados (3)" com
    // doze na lista seria pior do que o número mudar.
    const { html } = montar({
      owned: [umEvento({ id: 'a' }), umEvento({ id: 'b' })],
      joined: [umEvento({ id: 'c' })],
    });
    const abas = [...html.querySelectorAll('.tab-btn')].map((b) => b.textContent?.trim());

    expect(abas[0]).toContain('(2)');
    expect(abas[1]).toContain('(1)');
  });

  it('a vitrine é a mesma da home, e obedece ao modo escolhido', () => {
    TestBed.inject(LayoutEventosService);
    const { html } = montar({ owned: [umEvento()] });
    expect(html.querySelector('app-event-list')).toBeTruthy();
    expect(html.querySelector('app-event-card')).toBeTruthy();
  });
});
