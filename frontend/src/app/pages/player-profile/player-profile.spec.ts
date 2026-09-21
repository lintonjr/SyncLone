import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PlayerProfileComponent } from './player-profile';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../i18n/i18n';

/** Um perfil plausível, com só o que cada teste precisa declarar. */
function umPerfil(over: Record<string, unknown> = {}) {
  return {
    user: {
      id: 'u1',
      display_name: 'Ana Ribeiro',
      role: 'player',
      profile_public: 1,
      created_at: '2026-01-01',
    },
    totals: { events: 0, wins: 0, losses: 0, draws: 0, matches: 0, win_rate: null, titles: 0 },
    by_league: [],
    events: [],
    leagues: [],
    badges: [],
    ...over,
  };
}

function umEventoDoPerfil(over: Record<string, unknown> = {}) {
  return {
    event_id: 'e1',
    name: 'Copa Mercadia',
    date: '2026-05-18T20:00:00.000Z',
    game: 'MTG',
    league_id: 'lg1',
    league_name: 'Liga Alfa',
    event_status: 'completed',
    dropped: false,
    champion: false,
    position: 2,
    field_size: 8,
    wins: 3,
    losses: 1,
    draws: 0,
    points: 9,
    ...over,
  };
}

/**
 * Monta o componente e devolve a requisição pendente.
 *
 * O idioma é fixado porque os rótulos vêm do dicionário: sem isso o teste
 * passaria ou não dependendo do locale da máquina que o roda.
 */
function preparar() {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(PlayerProfileComponent);
  fixture.componentRef.setInput('id', 'u1');
  fixture.detectChanges();
  return { http, fixture, url: `${environment.apiUrl}/users/u1/profile` };
}

function montar(perfil: object) {
  const { http, fixture, url } = preparar();
  http.expectOne(url).flush(perfil);
  fixture.detectChanges();
  return fixture;
}

function montarComErro(status: number) {
  const { http, fixture, url } = preparar();
  http.expectOne(url).flush({ error: 'x' }, { status, statusText: 'x' });
  fixture.detectChanges();
  return fixture;
}

describe('PlayerProfileComponent', () => {
  it('mostra o nome e o histórico', async () => {
    const fixture = montar(
      umPerfil({
        totals: { events: 1, wins: 3, losses: 1, draws: 0, matches: 4, win_rate: 0.75, titles: 0 },
        events: [umEventoDoPerfil()],
      }),
    );
    await fixture.whenStable();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(texto).toContain('Ana Ribeiro');
    expect(texto).toContain('Copa Mercadia');
    expect(texto).toContain('75.0%');
  });

  it('sem partida jogada, o aproveitamento é "—" e não 0%', async () => {
    // 0% diria que a pessoa perdeu tudo; o que aconteceu é que ela não jogou.
    const fixture = montar(umPerfil({ totals: { ...umPerfil().totals, events: 1 } }));
    await fixture.whenStable();
    expect(fixture.componentInstance.aproveitamento()).toBe('—');
  });

  it('não mostra a seção de decks quando ninguém registrou nenhum', async () => {
    // Hoje nenhuma inscrição do sistema tem deck preenchido: a seção nasceria
    // vazia, e uma seção vazia é pior que seção nenhuma.
    const fixture = montar(umPerfil({ events: [umEventoDoPerfil({ deck_name: null })] }));
    await fixture.whenStable();

    expect(fixture.componentInstance.decks()).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Decks');
  });

  it('mostra cada deck com o aproveitamento e o tamanho da amostra', async () => {
    const fixture = montar(
      umPerfil({
        events: [
          umEventoDoPerfil({ event_id: 'e1', deck_name: 'Atraxa', wins: 3, losses: 1, draws: 0 }),
          umEventoDoPerfil({ event_id: 'e2', deck_name: 'atraxa ', wins: 3, losses: 1, draws: 0 }),
          umEventoDoPerfil({ event_id: 'e3', deck_name: 'Krenko', wins: 1, losses: 2, draws: 1 }),
        ],
      }),
    );
    await fixture.whenStable();

    const decks = fixture.componentInstance.decks();
    // Grafia diferente é o mesmo deck, e vence a mais usada.
    expect(decks.map((d) => d.deck)).toEqual(['Atraxa', 'Krenko']);
    // Empate vale meia vitória, como no aproveitamento geral do perfil.
    expect(decks[0]).toMatchObject({ eventos: 2, wins: 6, losses: 2, matches: 8, win_rate: 0.75 });
    expect(decks[1].win_rate).toBeCloseTo(0.375, 5);

    const html = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(html).toContain('75.0%');
    expect(html).toContain('Atraxa');
  });

  it('deck registrado sem partida aparece com "—", não com 0%', async () => {
    const fixture = montar(
      umPerfil({
        events: [umEventoDoPerfil({ deck_name: 'Só inscreveu', wins: 0, losses: 0, draws: 0 })],
      }),
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.decks()[0].win_rate).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.deck-taxa')?.textContent?.trim(),
    ).toBe('—');
  });

  it('quem saiu no meio não recebe colocação', async () => {
    const fixture = montar(
      umPerfil({ events: [umEventoDoPerfil({ dropped: true, position: null })] }),
    );
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('.drop-tag')).toBeTruthy();
    expect(html.querySelector('.rank-badge')).toBeFalsy();
  });
});

describe('PlayerProfileComponent · perfil privado', () => {
  it('403 diz que a pessoa escolheu fechar, não que não existe', async () => {
    const fixture = montarComErro(403);
    await fixture.whenStable();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(texto).toContain('privado');
    expect(texto).not.toContain('não encontrado');
  });

  it('404 continua dizendo que não foi encontrado', async () => {
    const fixture = montarComErro(404);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('não encontrado');
  });

  it('o titular vendo o próprio perfil fechado é avisado disso', async () => {
    // Só ele chega até aqui com o perfil fechado, e sem o aviso ficaria com a
    // impressão de que a página está no ar para todo mundo.
    const fixture = montar(
      umPerfil({
        user: { id: 'u1', display_name: 'Ana', role: 'player', profile_public: 0, created_at: 'x' },
      }),
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.ehMeuPerfilPrivado()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('.private-note')).toBeTruthy();
  });
});

describe('PlayerProfileComponent · recorte por liga', () => {
  const recorte = (over: Record<string, unknown> = {}) => ({
    key: 'lg1',
    league_id: 'lg1',
    name: 'Liga Alfa',
    events: 1,
    wins: 2,
    losses: 0,
    draws: 0,
    matches: 2,
    win_rate: 1,
    titles: 0,
    ...over,
  });

  /** Duas ligas e um punhado de eventos fora de qualquer uma delas. */
  const duasLigasEAvulsos = () =>
    umPerfil({
      totals: { events: 3, wins: 4, losses: 2, draws: 0, matches: 6, win_rate: 2 / 3, titles: 0 },
      by_league: [
        recorte(),
        recorte({
          key: 'lg2',
          league_id: 'lg2',
          name: 'Liga Beta',
          wins: 0,
          losses: 2,
          win_rate: 0,
        }),
        recorte({ key: 'avulsos', league_id: null, name: null }),
      ],
      events: [
        umEventoDoPerfil({ event_id: 'e1', league_id: 'lg1', league_name: 'Liga Alfa' }),
        umEventoDoPerfil({ event_id: 'e2', league_id: 'lg2', league_name: 'Liga Beta' }),
        umEventoDoPerfil({ event_id: 'e3', league_id: null, league_name: null }),
      ],
    });

  it('oferece "Geral" mais um recorte por liga jogada', async () => {
    const fixture = montar(duasLigasEAvulsos());
    await fixture.whenStable();
    const abas = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.cut')].map((b) =>
      b.textContent?.replace(/\s+/g, ' ').trim(),
    );

    expect(abas.length).toBe(4); // Geral + duas ligas + avulsos
    expect(abas[0]).toContain('Geral');
    expect(abas.join(' ')).toContain('Liga Alfa');
    expect(abas.join(' ')).toContain('Liga Beta');
  });

  it('não oferece liga em que a pessoa nunca jogou', async () => {
    const fixture = montar(duasLigasEAvulsos());
    await fixture.whenStable();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    // O servidor só devolve o que existe no histórico da pessoa.
    for (const nunca of ['Liga Gama', 'Liga 500', 'Season 2']) {
      expect(texto).not.toContain(nunca);
    }
  });

  it('o grupo dos avulsos ganha rótulo do sistema, não nome de liga', async () => {
    // Nome de liga é dado; "Avulsos" é rótulo — e rótulo se traduz.
    const fixture = montar(duasLigasEAvulsos());
    await fixture.whenStable();
    const c = fixture.componentInstance;

    expect(c.rotuloDoRecorte({ league_id: null, name: null })).toBe(
      TestBed.inject(I18nService).t('profilePub.standalone'),
    );
    expect(c.rotuloDoRecorte({ league_id: 'lg1', name: 'Liga Alfa' })).toBe('Liga Alfa');
  });

  it('avulsos aparece por último, mesmo sendo o mais jogado', async () => {
    // Não é uma liga, é o resto: a ordem por quantidade não vale para ele.
    const fixture = montar(
      umPerfil({
        by_league: [
          recorte({ key: 'lg1', events: 1 }),
          recorte({ key: 'avulsos', league_id: null, name: null, events: 9 }),
        ],
        events: [umEventoDoPerfil()],
      }),
    );
    await fixture.whenStable();
    const abas = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.cut')].map((b) =>
      b.textContent?.replace(/\s+/g, ' ').trim(),
    );

    expect(abas[abas.length - 1]).toContain(TestBed.inject(I18nService).t('profilePub.standalone'));
  });

  it('com uma liga só, não mostra recorte nenhum', async () => {
    // "Geral" e a ficha dela seriam a mesma tabela com dois nomes.
    const fixture = montar(umPerfil({ by_league: [recorte()], events: [umEventoDoPerfil()] }));
    await fixture.whenStable();

    expect(fixture.componentInstance.mostrarRecortes()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('.cuts')).toBeFalsy();
  });

  it('escolher uma liga troca os números e o histórico', async () => {
    const fixture = montar(duasLigasEAvulsos());
    await fixture.whenStable();
    const c = fixture.componentInstance;

    expect(c.emFoco().events).toBe(3);
    expect(c.eventosEmFoco().length).toBe(3);

    c.recorte.set('lg2');
    fixture.detectChanges();

    expect(c.emFoco().wins).toBe(0);
    expect(c.aproveitamento()).toBe('0.0%');
    expect(c.eventosEmFoco().map((e) => e.event_id)).toEqual(['e2']);
  });

  it('o recorte dos avulsos traz só o que está fora de liga', async () => {
    const fixture = montar(duasLigasEAvulsos());
    await fixture.whenStable();
    const c = fixture.componentInstance;

    c.recorte.set('avulsos');
    fixture.detectChanges();

    expect(c.eventosEmFoco().map((e) => e.event_id)).toEqual(['e3']);
  });

  it('o recorte geral volta a somar tudo', async () => {
    const fixture = montar(duasLigasEAvulsos());
    await fixture.whenStable();
    const c = fixture.componentInstance;

    c.recorte.set('lg1');
    fixture.detectChanges();
    expect(c.eventosEmFoco().length).toBe(1);

    c.recorte.set('all');
    fixture.detectChanges();
    expect(c.emFoco().events).toBe(3);
    expect(c.eventosEmFoco().length).toBe(3);
  });
});

describe('PlayerProfileComponent · badges', () => {
  const badge = (over: Record<string, unknown> = {}) => ({
    id: 'ub1',
    badge_id: 'b1',
    name: 'Campeão do Mês',
    image: '/uploads/x.png',
    visible: 1,
    awarded_at: '2026-05-01',
    awarded_by_name: 'Loja Mercadia',
    ...over,
  });

  it('mostra as badges visíveis ao lado do nome', async () => {
    const fixture = montar(
      umPerfil({ badges: [badge(), badge({ id: 'ub2', badge_id: 'b2', name: 'Fair Play' })] }),
    );
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    const naLinha = html.querySelectorAll('.name-row .badge-inline');
    expect(naLinha.length).toBe(2);
    expect(naLinha[0].getAttribute('alt')).toBe('Campeão do Mês');
  });

  it('não mostra badge que o jogador escondeu', async () => {
    // O servidor já não manda as escondidas para visitantes; este teste garante
    // que a tela também não as desenharia se um dia mandasse.
    const fixture = montar(
      umPerfil({ badges: [badge(), badge({ id: 'ub2', name: 'Secreta', visible: 0 })] }),
    );
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelectorAll('.name-row .badge-inline').length).toBe(1);
    expect(fixture.componentInstance.badgesVisiveis().length).toBe(1);
  });

  it('acima do teto, o excedente vira "+n" em vez de esticar o cabeçalho', async () => {
    const sete = Array.from({ length: 7 }, (_, i) =>
      badge({ id: `ub${i}`, badge_id: `b${i}`, name: `Badge ${i}` }),
    );
    const fixture = montar(umPerfil({ badges: sete }));
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelectorAll('.name-row .badge-inline').length).toBe(5);
    expect(fixture.componentInstance.badgesAlem()).toBe(2);
    expect(html.querySelector('.badge-more')?.textContent?.trim()).toBe('+2');
  });

  it('sem badge nenhuma, nada disso aparece', async () => {
    const fixture = montar(umPerfil());
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('.badge-strip')).toBeFalsy();
    expect(html.querySelector('.badge-showcase')).toBeFalsy();
  });

  it('com uma badge só, a vitrine já aparece', async () => {
    // A miniatura ao lado do nome é adorno; a vitrine é onde a conquista se vê.
    // Ela não espera passar de um teto para existir.
    const fixture = montar(umPerfil({ badges: [badge()] }));
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('.badge-showcase')).toBeTruthy();
    expect(html.querySelectorAll('.badge-piece').length).toBe(1);
  });

  it('a vitrine vem antes das métricas', async () => {
    const fixture = montar(umPerfil({ badges: [badge()] }));
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    const vitrine = html.querySelector('.badge-showcase')!;
    const metricas = html.querySelector('.stat-grid')!;
    // DOCUMENT_POSITION_FOLLOWING: as métricas vêm depois da vitrine.
    expect(
      vitrine.compareDocumentPosition(metricas) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('visitante não recebe o botão de ligar e desligar', async () => {
    const oito = Array.from({ length: 8 }, (_, i) => badge({ id: `ub${i}`, badge_id: `b${i}` }));
    const fixture = montar(umPerfil({ badges: oito }));
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('.badge-showcase')).toBeTruthy();
    expect(html.querySelector('.badge-toggle')).toBeFalsy();
  });

  it('visitante não vê vitrine quando tudo está escondido', async () => {
    // Todas escondidas: para quem visita, é como se não houvesse badge nenhuma.
    const fixture = montar(
      umPerfil({ badges: [badge({ visible: 0 }), badge({ id: 'ub2', visible: 0 })] }),
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.mostrarSecaoBadges()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('.badge-showcase')).toBeFalsy();
  });
});
