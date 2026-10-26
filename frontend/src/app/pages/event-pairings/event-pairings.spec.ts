import { TestBed } from '@angular/core/testing';
import { EventPairingsComponent } from './event-pairings';
import { umEvento, umaMesa, umaRodada } from '../../testing/fixtures';
import { I18nService } from '../../i18n/i18n';
import { podPlayerResult } from '../event-detail/pod-view';
import { Pairing } from '../../services/event';

/**
 * Testes de template da aba de pareamentos.
 *
 * O caso central é o B-01: a tela escolhe entre desenhar uma mesa de quatro e
 * desenhar um duelo olhando o formato e o `pod_size`. Quando essa decisão errou,
 * metade dos jogadores sumiu da tela sem nenhum erro em lugar nenhum.
 */
function montar(evento: Parameters<typeof umEvento>[0], mesas = [umaMesa()], rodada = umaRodada()) {
  const fixture = TestBed.createComponent(EventPairingsComponent);
  fixture.componentRef.setInput('ev', umEvento(evento));
  fixture.componentRef.setInput('isOwner', true);
  fixture.componentRef.setInput('current', { round: rodada, pairings: mesas });
  fixture.detectChanges();
  return fixture;
}

const mesaDeQuatro = umaMesa({
  player1_id: 'p1',
  player2_id: 'p2',
  player3_id: 'p3',
  player4_id: 'p4',
  p1_name: 'Ana',
  p2_name: 'Bruno',
  p3_name: 'Carla',
  p4_name: 'Diego',
});

describe('EventPairingsComponent', () => {
  it('desenha os quatro assentos num Clã Fronto', async () => {
    // Clã Fronto é sempre mesa de quatro, independente do pod_size gravado —
    // e foi um pod_size divergente que escondeu metade da mesa.
    const fixture = montar({ tournament_format: 'clafronto', pod_size: 4 }, [mesaDeQuatro]);
    await fixture.whenStable();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    for (const nome of ['Ana', 'Bruno', 'Carla', 'Diego']) {
      expect(texto).toContain(nome);
    }
  });

  it('continua desenhando os quatro mesmo se o pod_size do evento vier errado', async () => {
    // A trava do servidor impede isso hoje; o teste garante que a tela não
    // volte a depender só dela.
    const fixture = montar({ tournament_format: 'clafronto', pod_size: 2 }, [mesaDeQuatro]);
    await fixture.whenStable();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(fixture.componentInstance.isPodMode()).toBe(true);
    expect(texto).toContain('Carla');
    expect(texto).toContain('Diego');
  });

  it('num evento comum de 1v1 desenha o duelo', async () => {
    const fixture = montar({ pod_size: 2 }, [umaMesa({ p1_name: 'Ana', p2_name: 'Bruno' })]);
    await fixture.whenStable();
    expect(fixture.componentInstance.isPodMode()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Ana');
  });

  it('com o tempo ainda parado, o organizador vê o botão de soltar', async () => {
    // A rodada nasce pareada e com o relógio parado: é a janela para os
    // jogadores acharem a mesa. Quem decide encerrá-la é o organizador.
    const fixture = montar({}, [umaMesa()], umaRodada({ timer_started_at: null }));
    fixture.componentRef.setInput('timer', {
      waiting: true,
      over: false,
      warning: false,
      label: 'aguardando início',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    const botao = html.querySelector('.timer-start-btn') as HTMLButtonElement;
    expect(botao).toBeTruthy();
    expect(botao.textContent?.trim()).toBe(TestBed.inject(I18nService).t('pairings.startTimer'));

    const emitidos: unknown[] = [];
    fixture.componentInstance.startTimer.subscribe(() => emitidos.push(1));
    botao.click();
    expect(emitidos.length).toBe(1);
  });

  it('com o tempo ainda parado, quem não organiza vê que está aguardando', async () => {
    const fixture = TestBed.createComponent(EventPairingsComponent);
    fixture.componentRef.setInput('ev', umEvento({}));
    fixture.componentRef.setInput('isOwner', false);
    fixture.componentRef.setInput('current', {
      round: umaRodada({ timer_started_at: null }),
      pairings: [umaMesa()],
    });
    fixture.componentRef.setInput('timer', {
      waiting: true,
      over: false,
      warning: false,
      label: 'aguardando início',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('.timer-start-btn')).toBeFalsy();
    // O rótulo do relógio vem do próprio cronômetro, não do dicionário.
    expect(html.textContent).toContain('aguardando início');
    expect(html.querySelector('.timer-waiting')).toBeTruthy();
  });

  it('com o tempo correndo, mostra o relógio e não o aviso de espera', async () => {
    const fixture = montar(
      {},
      [umaMesa()],
      umaRodada({ timer_started_at: '2026-10-01T20:00:00.000Z' }),
    );
    fixture.componentRef.setInput('timer', {
      waiting: false,
      over: false,
      warning: false,
      label: '42:10',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.textContent).toContain('42:10');
    expect(html.textContent).not.toContain('aguardando início');
  });

  it('não deixa editar resultado de rodada que já passou', async () => {
    const rodada = umaRodada({ round_number: 1 });
    const fixture = montar({ current_round: 2 }, [umaMesa({ result: 'player1' })], rodada);
    await fixture.whenStable();

    expect(fixture.componentInstance.canEditResult(umaMesa({ result: 'player1' }), rodada)).toBe(
      false,
    );
  });
});

describe('podPlayerResult · mesa de duplas', () => {
  // O card marcava o parceiro do vencedor como derrotado enquanto a tabela lhe
  // dava os pontos — a mesma divergência do C-05, um andar acima. Quem venceu
  // passou a vir do servidor, que é onde a regra dos parceiros mora.
  const mesa = {
    id: 'm',
    round_id: 'r',
    event_id: 'e',
    table_number: 1,
    player1_id: 'eva',
    player2_id: 'caio',
    player3_id: 'fabio',
    player4_id: 'dora',
    result: 'player1',
    winner_ids: ['eva', 'fabio'],
  } as Pairing;

  it('dá vitória ao parceiro do assento vencedor', () => {
    expect(podPlayerResult(mesa, 'player1')).toBe('win');
    expect(podPlayerResult(mesa, 'player3')).toBe('win');
    expect(podPlayerResult(mesa, 'player2')).toBe('loss');
    expect(podPlayerResult(mesa, 'player4')).toBe('loss');
  });

  it('sem winner_ids, cai na comparação por assento', () => {
    const antiga = { ...mesa, winner_ids: undefined };
    expect(podPlayerResult(antiga, 'player1')).toBe('win');
    expect(podPlayerResult(antiga, 'player3')).toBe('loss');
  });

  it('empate e bye não dependem do lado vencedor', () => {
    expect(podPlayerResult({ ...mesa, result: 'draw' }, 'player2')).toBe('draw');
    expect(podPlayerResult({ ...mesa, result: 'bye' }, 'player3')).toBe('bye');
  });
});

// --- Cartel ao lado do nome ---

describe('EventPairingsComponent — cartel', () => {
  /** Duas rodadas jogadas, a terceira em aberto. */
  const historico = () => {
    const r1 = umaRodada({ id: 'r1', round_number: 1 });
    const r2 = umaRodada({ id: 'r2', round_number: 2 });
    const r3 = umaRodada({ id: 'r3', round_number: 3, status: 'active' });
    const mesas: Pairing[] = [
      // R1: Ana vence Bruno; Carla empata com Diego; Elisa leva bye
      umaMesa({ id: 'm1', round_id: 'r1', player1_id: 'ana', player2_id: 'bruno', result: 'player1' }),
      umaMesa({ id: 'm2', round_id: 'r1', player1_id: 'carla', player2_id: 'diego', result: 'draw' }),
      umaMesa({ id: 'm3', round_id: 'r1', player1_id: 'elisa', player2_id: undefined, result: 'bye' }),
      // R2: Ana vence Carla; Bruno vence Diego
      umaMesa({ id: 'm4', round_id: 'r2', player1_id: 'ana', player2_id: 'carla', result: 'player1' }),
      umaMesa({ id: 'm5', round_id: 'r2', player1_id: 'bruno', player2_id: 'diego', result: 'player1' }),
      // R3: ainda sem resultado — é a rodada mostrada
      umaMesa({ id: 'm6', round_id: 'r3', player1_id: 'ana', player2_id: 'bruno', p1_name: 'Ana', p2_name: 'Bruno', result: undefined }),
    ];
    return { rounds: [r1, r2, r3], mesas, r3 };
  };

  const montarCom = () => {
    const { rounds, mesas, r3 } = historico();
    const fixture = TestBed.createComponent(EventPairingsComponent);
    fixture.componentRef.setInput('ev', umEvento({ pod_size: 2, rounds, pairings: mesas, current_round: 3 }));
    fixture.componentRef.setInput('isOwner', true);
    fixture.componentRef.setInput('current', { round: r3, pairings: [mesas[5]] });
    fixture.detectChanges();
    return fixture;
  };

  it('conta vitória, derrota, empate e bye nas rodadas anteriores', async () => {
    const fixture = montarCom();
    await fixture.whenStable();
    const c = fixture.componentInstance;

    expect(c.cartel('ana')).toBe('2-0-0');    // venceu as duas
    expect(c.cartel('bruno')).toBe('1-1-0');  // perdeu da Ana, venceu o Diego
    expect(c.cartel('carla')).toBe('0-1-1');  // empate na 1, derrota na 2
    expect(c.cartel('diego')).toBe('0-1-1');  // empate na 1, derrota na 2
    expect(c.cartel('elisa')).toBe('1-0-0');  // o bye conta como vitória
  });

  it('quem ainda não jogou aparece como 0-0-0, não em branco', async () => {
    const fixture = montarCom();
    await fixture.whenStable();
    expect(fixture.componentInstance.cartel('ninguem')).toBe('0-0-0');
  });

  it('o cartel aparece ao lado do nome na tabela de duelo', async () => {
    const fixture = montarCom();
    await fixture.whenStable();
    const cartéis = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.cartel')].map(
      (e) => e.textContent?.trim(),
    );
    expect(cartéis).toEqual(['2-0-0', '1-1-0']);
  });

  it('NÃO conta a rodada mostrada: lançar resultado não mexe no cartel ao lado', async () => {
    // É o motivo de o cartel ser "antes da rodada" e não o total corrente: com o
    // total, o número mudaria debaixo do organizador enquanto ele digita.
    const { rounds, mesas, r3 } = historico();
    const decidida = { ...mesas[5], result: 'player1', result_status: 'confirmed' } as Pairing;
    const fixture = TestBed.createComponent(EventPairingsComponent);
    fixture.componentRef.setInput('ev', umEvento({
      pod_size: 2, rounds, pairings: [...mesas.slice(0, 5), decidida], current_round: 3,
    }));
    fixture.componentRef.setInput('isOwner', true);
    fixture.componentRef.setInput('current', { round: r3, pairings: [decidida] });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.cartel('ana')).toBe('2-0-0');
    expect(fixture.componentInstance.cartel('bruno')).toBe('1-1-0');
  });

  it('auto-relato ainda não aprovado não entra no cartel', async () => {
    // A mesma regra do servidor: resultado pendente não move a classificação.
    const { rounds, mesas, r3 } = historico();
    const pendente = { ...mesas[4], result_status: 'pending' } as Pairing;
    const fixture = TestBed.createComponent(EventPairingsComponent);
    fixture.componentRef.setInput('ev', umEvento({
      pod_size: 2, rounds, pairings: [...mesas.slice(0, 4), pendente, mesas[5]], current_round: 3,
    }));
    fixture.componentRef.setInput('isOwner', true);
    fixture.componentRef.setInput('current', { round: r3, pairings: [mesas[5]] });
    fixture.detectChanges();
    await fixture.whenStable();

    // Bruno venceu o Diego na R2, mas o resultado está pendente de aprovação.
    expect(fixture.componentInstance.cartel('bruno')).toBe('0-1-0');
  });
});
