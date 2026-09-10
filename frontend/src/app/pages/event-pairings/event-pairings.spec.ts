import { TestBed } from '@angular/core/testing';
import { EventPairingsComponent } from './event-pairings';
import { umEvento, umaMesa, umaRodada } from '../../testing/fixtures';
import { I18nService } from '../../i18n/i18n';

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
