import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LeagueDetailComponent } from './league-detail';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../i18n/i18n';

const API = `${environment.apiUrl}/leagues/liga1`;

function umaLiga(over: Record<string, unknown> = {}) {
  return {
    id: 'liga1',
    name: 'Liga de Sexta',
    owner_id: 'dona',
    owner_name: 'Dona da Liga',
    playoff_counts: 1,
    pontos_extra: 0,
    created_at: '2026-09-01T00:00:00.000Z',
    events: [],
    standings: [],
    organizers: [{ user_id: 'bia', display_name: 'Bia Coorganizadora' }],
    ...over,
  };
}

/** Monta a página da liga já respondida, com `usuarioId` logado (ou ninguém). */
async function montar(usuarioId: string | null, liga = umaLiga()) {
  // Alguns testes montam a página mais de uma vez (com e sem bônus), e o TestBed
  // recusa ser configurado depois de instanciado.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  if (usuarioId) {
    TestBed.inject(AuthService).currentUser.set({
      id: usuarioId,
      display_name: usuarioId,
      email: `${usuarioId}@t.local`,
      role: 'organizer',
    } as never);
  }
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(LeagueDetailComponent);
  fixture.componentRef.setInput('id', 'liga1');
  fixture.detectChanges();
  http.expectOne(API).flush(liga);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, http, html: fixture.nativeElement as HTMLElement };
}

const botoes = (html: HTMLElement) =>
  [...html.querySelectorAll('button, a.btn')].map((b) => b.textContent?.trim());

describe('LeagueDetailComponent — time da liga', () => {
  it('mostra o dono e os co-organizadores para qualquer visitante, sem controles', async () => {
    const { html } = await montar(null);

    const time = html.querySelector('.organizers')!;
    expect(time.textContent).toContain('Dona da Liga');
    expect(time.textContent).toContain('Dono');
    expect(time.textContent).toContain('Bia Coorganizadora');
    expect(html.querySelector('.organizer-add')).toBeFalsy();
    expect(botoes(html)).not.toContain('Editar');
    expect(botoes(html)).not.toContain('Remover');
  });

  it('dono: edita, exclui e escolhe o time', async () => {
    const { html } = await montar('dona');

    expect(botoes(html)).toContain('Editar');
    expect(botoes(html)).toContain('Excluir');
    expect(botoes(html)).toContain('Remover');
    expect(html.querySelector('.organizer-add')).toBeTruthy();
  });

  it('co-organizador: edita a liga e pode sair do time, mas não exclui nem escolhe o time', async () => {
    const { html } = await montar('bia');

    expect(botoes(html)).toContain('Editar');
    expect(botoes(html)).toContain('Sair do time');
    expect(botoes(html)).not.toContain('Excluir');
    expect(botoes(html)).not.toContain('Remover');
    expect(html.querySelector('.organizer-add')).toBeFalsy();
  });

  it('dono adiciona pelo e-mail e a lista vem atualizada do servidor', async () => {
    const { fixture, http, html } = await montar('dona');

    const input = html.querySelector<HTMLInputElement>('.organizer-add input')!;
    input.value = 'caio@t.local';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    html.querySelector<HTMLFormElement>('.organizer-add')!.dispatchEvent(new Event('submit'));

    const req = http.expectOne(`${API}/organizers`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'caio@t.local' });
    req.flush([
      { user_id: 'bia', display_name: 'Bia Coorganizadora' },
      { user_id: 'caio', display_name: 'Caio Novo' },
    ]);
    fixture.detectChanges();

    expect(html.querySelector('.organizers')!.textContent).toContain('Caio Novo');
  });

  it('erro do servidor aparece traduzido na seção do time', async () => {
    const { fixture, http, html } = await montar('dona');

    const input = html.querySelector<HTMLInputElement>('.organizer-add input')!;
    input.value = 'jogador@t.local';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    html.querySelector<HTMLFormElement>('.organizer-add')!.dispatchEvent(new Event('submit'));

    http
      .expectOne(`${API}/organizers`)
      .flush(
        { error: 'Cannot add this organizer', code: 'api.coOrganizerMustOrganize' },
        { status: 400, statusText: 'Bad Request' },
      );
    fixture.detectChanges();

    expect(html.querySelector('.organizers .error-msg')?.textContent).toContain(
      'Só quem já é organizador',
    );
  });
});

describe('LeagueDetailComponent — ponto extra por torneio', () => {
  const classificacao = [
    // Jogou 3, deu drop em 1: o bônus conta os 4, os pontos de mesa só os 3.
    { user_id: 'ana', display_name: 'Ana', points: 33, wins: 7, losses: 2, draws: 0, events_played: 3, events_bonus: 4, bonus: 12 },
    { user_id: 'bia', display_name: 'Bia', points: 24, wins: 6, losses: 3, draws: 0, events_played: 3, events_bonus: 3, bonus: 9 },
  ];

  it('sem bônus, a tabela é a de antes: nenhuma coluna a mais', async () => {
    const { html } = await montar(null, umaLiga({
      pontos_extra: 0,
      standings: [{ ...classificacao[1], bonus: 0, events_bonus: 0, points: 15 }],
    }));

    const cabecalhos = [...html.querySelectorAll('.standings-table th')].map((t) => t.textContent?.trim());
    expect(cabecalhos).toEqual(['Posição', 'Jogador', 'Eventos', 'W', 'L', 'D', 'Pts']);
    expect(html.querySelector('.bonus-cell')).toBeFalsy();
  });

  it('com bônus, a coluna aparece e o total já traz o bônus dentro', async () => {
    const { html } = await montar(null, umaLiga({ pontos_extra: 3, standings: classificacao }));

    const cabecalhos = [...html.querySelectorAll('.standings-table th')].map((t) => t.textContent?.trim());
    expect(cabecalhos).toEqual(['Posição', 'Jogador', 'Eventos', 'W', 'L', 'D', 'Bônus', 'Pts']);

    const bonus = [...html.querySelectorAll('.bonus-cell')].map((c) => c.textContent?.trim());
    expect(bonus).toEqual(['+12', '+9']);

    // `points` é o total: quem lê a tabela vê o número que vale, não a parte de mesa.
    const pontos = [...html.querySelectorAll('.standings-table tbody tr')]
      .map((tr) => tr.querySelector('td:last-child')?.textContent?.trim());
    expect(pontos).toEqual(['33', '24']);
  });

  it('o detalhe do bônus diz de quantos torneios ele veio, drop incluído', async () => {
    const { html } = await montar(null, umaLiga({ pontos_extra: 3, standings: classificacao }));

    // Ana aparece com 3 na coluna Eventos e 4 torneios no bônus: ela deu drop em
    // um. É por isso que o título existe — senão a conta não fecharia na tela.
    const primeira = html.querySelectorAll('.standings-table tbody tr')[0];
    expect(primeira.querySelector('td[data-rotulo="Eventos"]')?.textContent?.trim()).toBe('3');
    expect(primeira.querySelector('.bonus-cell')?.getAttribute('title')).toBe('4 torneio(s) × 3 ponto(s)');
  });
});

