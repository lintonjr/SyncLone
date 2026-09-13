import { TestBed } from '@angular/core/testing';
import { EventStandingsComponent } from './event-standings';
import { umEvento, umJogador } from '../../testing/fixtures';
import { I18nService } from '../../i18n/i18n';
import { provideRouter } from '@angular/router';

/**
 * Testes de template da aba de classificação.
 *
 * Os dois primeiros existem por causa de bugs que chegaram a rodar: a fila de
 * aprovação que ficava inalcançável e o selo de entrada tardia. Nenhum dos dois
 * era detectável por teste de serviço — eram de template puro.
 */
/**
 * O nome de quem tem conta virou link para o perfil, então o componente passou a
 * depender do router — daí o provider, que antes não era necessário.
 */
function comRouter() {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
}

/** Fixa o idioma: o texto vem do dicionário, e o teste não pode depender do locale da máquina. */
function comIdiomaFixo() {
  const i18n = TestBed.inject(I18nService);
  i18n.lang.set('pt-BR');
  return i18n;
}

function montar(over: Parameters<typeof umEvento>[0] = {}, isOwner = true) {
  comRouter();
  comIdiomaFixo();
  const fixture = TestBed.createComponent(EventStandingsComponent);
  fixture.componentRef.setInput('ev', umEvento(over));
  fixture.componentRef.setInput('isOwner', isOwner);
  fixture.detectChanges();
  return fixture;
}

describe('EventStandingsComponent', () => {
  it('mostra a fila de aprovação mesmo quando NÃO existe nenhum jogador ativo', async () => {
    // O bug: a seção de pendentes vivia dentro do @else do bloco da tabela, que
    // só renderizava com jogadores ativos. Com todo mundo pendente, o
    // organizador ficava sem nenhum caminho para aprovar — impasse completo.
    const fixture = montar({
      confirm_players: 1,
      current_round: 0,
      players: [
        umJogador({ id: 'p1', display_name: 'Ana', status: 'pending' }),
        umJogador({ id: 'p2', display_name: 'Bruno', status: 'pending' }),
      ],
    });
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('.pending-section')).toBeTruthy();
    expect(html.textContent).toContain('Ana');
    expect(html.querySelectorAll('.pending-row').length).toBe(2);
    const i18n = TestBed.inject(I18nService);
    expect(html.querySelector('.pending-actions-bulk button')?.textContent).toContain(
      i18n.t('standings.approve'),
    );
  });

  it('não mostra a fila para quem não organiza', async () => {
    const fixture = montar(
      { players: [umJogador({ status: 'pending', display_name: 'Ana' })] },
      false,
    );
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.pending-section')).toBeFalsy();
  });

  it('marca quem entrou depois, e só essa pessoa', async () => {
    // swiss_rounds_total 3 contra swiss_rounds_seated 1: a jogadora perdeu duas rodadas.
    const fixture = montar({
      swiss_rounds_total: 3,
      current_round: 3,
      players: [
        umJogador({ id: 'p1', display_name: 'Ana', swiss_rounds_seated: 3 }),
        umJogador({ id: 'p2', display_name: 'Gina', swiss_rounds_seated: 1 }),
      ],
    });
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    const selos = html.querySelectorAll('.late-tag');
    expect(selos.length).toBe(1);
    expect(selos[0].textContent).toContain('2');
    const linhaDaGina = [...html.querySelectorAll('tbody tr')].find((tr) =>
      tr.textContent?.includes('Gina'),
    );
    expect(linhaDaGina?.querySelector('.late-tag')).toBeTruthy();
  });

  it('não marca ninguém quando todos jogaram tudo', async () => {
    const fixture = montar({
      swiss_rounds_total: 2,
      players: [
        umJogador({ id: 'p1', swiss_rounds_seated: 2 }),
        umJogador({ id: 'p2', swiss_rounds_seated: 2 }),
      ],
    });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.late-tag').length).toBe(0);
  });

  it('emite a aprovação em vez de chamar o servidor por conta própria', async () => {
    const fixture = montar({ players: [umJogador({ id: 'px', status: 'pending' })] });
    await fixture.whenStable();
    const emitidos: string[] = [];
    fixture.componentInstance.approve.subscribe((id) => emitidos.push(id));

    const rotulo = TestBed.inject(I18nService).t('standings.approve');
    const botao = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('.pending-row button'),
    ].find((b) => b.textContent?.trim() === rotulo) as HTMLButtonElement;
    botao.click();

    expect(emitidos).toEqual(['px']);
  });
});

describe('EventStandingsComponent · playoffs não marcam entrada tardia', () => {
  it('quem não passou para o mata-mata não é marcado como entrada tardia', async () => {
    // O bug: `rounds_total` contava as rodadas de playoff, que por definição só
    // alguns jogam. No instante em que o Top 4 começava, os quatro eliminados
    // ganhavam "entrou depois · −1" — sem terem entrado depois de nada.
    // A régua agora são as rodadas suíças, e todos jogaram as duas.
    const fixture = montar({
      swiss_rounds_total: 2,
      current_round: 3,
      players: [
        umJogador({ id: 'p1', display_name: 'Passou', swiss_rounds_seated: 2 }),
        umJogador({ id: 'p2', display_name: 'Eliminado', swiss_rounds_seated: 2 }),
      ],
    });
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.late-tag').length).toBe(0);
  });

  it('mas quem realmente perdeu rodadas suíças continua marcado', async () => {
    const fixture = montar({
      swiss_rounds_total: 4,
      players: [
        umJogador({ id: 'p1', display_name: 'Veterano', swiss_rounds_seated: 4 }),
        umJogador({ id: 'p2', display_name: 'Tardio', swiss_rounds_seated: 1 }),
      ],
    });
    await fixture.whenStable();
    const selos = (fixture.nativeElement as HTMLElement).querySelectorAll('.late-tag');

    expect(selos.length).toBe(1);
    expect(selos[0].textContent).toContain('3');
  });
});

describe('EventStandingsComponent · perfil público é escolha do jogador', () => {
  it('não linka o nome de quem fechou o próprio perfil', async () => {
    // Linkar para uma página que responde 403 é pior que não linkar. E o nome
    // continua na tabela: fechar o perfil não esconde resultado de evento.
    const fixture = montar({
      players: [
        umJogador({ id: 'p1', user_id: 'u1', display_name: 'Aberta', profile_public: 1 }),
        umJogador({ id: 'p2', user_id: 'u2', display_name: 'Fechada', profile_public: 0 }),
      ],
    });
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    const links = [...html.querySelectorAll('.player-link')].map((a) => a.textContent?.trim());
    expect(links).toEqual(['Aberta']);
    expect(html.textContent).toContain('Fechada');
  });

  it('conta sem preferência gravada continua sendo tratada como pública', async () => {
    const fixture = montar({
      players: [umJogador({ id: 'p1', user_id: 'u1', display_name: 'Antiga' })],
    });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.player-link')).toBeTruthy();
  });

  it('convidado não vira link e ganha o botão de vincular para o organizador', async () => {
    const fixture = montar({
      players: [umJogador({ id: 'p1', user_id: null, display_name: 'Convidado' })],
    });
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('.player-link')).toBeFalsy();
    expect(html.querySelector('.link-guest-btn')).toBeTruthy();
  });

  it('mas quem tem conta nunca oferece vincular, mesmo com perfil fechado', async () => {
    const fixture = montar({
      players: [umJogador({ id: 'p1', user_id: 'u1', display_name: 'Fechada', profile_public: 0 })],
    });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.link-guest-btn')).toBeFalsy();
  });
});

/** Uma linha de classificação por time, com os desempates que a tabela lê. */
function umTime(over: Record<string, unknown>) {
  return {
    id: 'A',
    name: 'Time',
    players: [],
    player_count: 4,
    points: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    mwp: null,
    omw: null,
    gwp: null,
    ogw: null,
    ...over,
  } as unknown as NonNullable<ReturnType<typeof umEvento>['clan_standings']>[number];
}

describe('EventStandingsComponent · formatos de time', () => {
  it('no partner, a chave da tabela fala em duplas', () => {
    // O mesmo componente serve aos dois formatos; o que muda é o substantivo.
    // Um `isClanFormat` esquecido aqui deixaria um torneio de duplas anunciando
    // "Clãs" — do tipo de defeito que só a montagem do template pega.
    const fixture = montar({
      tournament_format: 'partner',
      pod_size: 4,
      clan_standings: [
        umTime({ id: 'A', name: 'Ana & Bruno', player_count: 2, points: 3, wins: 1 }),
      ],
    });
    const abas = [...fixture.nativeElement.querySelectorAll('.standings-switch .switch-btn')];
    expect(abas.length).toBe(2);
    expect(abas[0].textContent).toContain('Duplas');
    expect(abas[0].textContent).not.toContain('Clãs');
    expect(fixture.nativeElement.querySelector('thead th:nth-child(2)').textContent).toContain(
      'Dupla',
    );
  });

  it('no Clã Fronto a chave continua falando em clãs', () => {
    const fixture = montar({
      tournament_format: 'clafronto',
      pod_size: 4,
      clan_standings: [umTime({ id: 'A', name: 'Dragões', player_count: 4, points: 9, wins: 3 })],
    });
    const abas = [...fixture.nativeElement.querySelectorAll('.standings-switch .switch-btn')];
    expect(abas[0].textContent).toContain('Clãs');
  });

  it('num torneio comum não existe chave nenhuma', () => {
    const fixture = montar({ tournament_format: 'standard' });
    expect(fixture.nativeElement.querySelector('.standings-switch')).toBeNull();
  });
});
