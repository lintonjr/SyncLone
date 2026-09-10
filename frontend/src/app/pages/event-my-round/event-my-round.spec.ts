import { TestBed } from '@angular/core/testing';
import { EventMyRoundComponent } from './event-my-round';
import { umEvento, umJogador, umaMesa, umaRodada } from '../../testing/fixtures';

/**
 * Testes da única tela escrita para quem joga, e não para quem organiza.
 */
function montar(evento: Parameters<typeof umEvento>[0] = {}, mr: unknown = null) {
  const fixture = TestBed.createComponent(EventMyRoundComponent);
  fixture.componentRef.setInput('ev', umEvento(evento));
  fixture.componentRef.setInput('mr', mr);
  fixture.detectChanges();
  return fixture;
}

const eu = umJogador({ id: 'p1', display_name: 'Ana' });

describe('EventMyRoundComponent', () => {
  it('sem mesa na rodada, explica em vez de mostrar tela vazia', async () => {
    const fixture = montar({ rounds: [umaRodada()] });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('no active pairing');
  });

  it('mostra o adversário e o botão de reportar num duelo', async () => {
    const fixture = montar(
      { pod_size: 2 },
      { round: umaRodada(), pairing: umaMesa({ p1_name: 'Ana', p2_name: 'Bruno' }), myPlayer: eu },
    );
    await fixture.whenStable();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(texto).toContain('Ana');
    expect(texto).toContain('Bruno');
    expect(fixture.componentInstance.mySlot()).toBe('player1');
    expect(fixture.componentInstance.opponentSlot()).toBe('player2');
  });

  it('numa mesa de quatro lista os quatro, sem falar em adversário único', async () => {
    const mesa = umaMesa({
      player1_id: 'p1',
      player2_id: 'p2',
      player3_id: 'p3',
      player4_id: 'p4',
      p1_name: 'Ana',
      p2_name: 'Bruno',
      p3_name: 'Carla',
      p4_name: 'Diego',
    });
    const fixture = montar({ pod_size: 4 }, { round: umaRodada(), pairing: mesa, myPlayer: eu });
    await fixture.whenStable();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    for (const nome of ['Ana', 'Bruno', 'Carla', 'Diego']) expect(texto).toContain(nome);
    expect(fixture.componentInstance.isPodMode()).toBe(true);
  });

  it('numa mesa de quatro não oferece "I Lost" — não existe adversário único', async () => {
    // "Perdi" só faz sentido em duelo: numa mesa de quatro, dizer que perdeu não
    // diz quem ganhou. O botão existe só no ramo 1v1, e é isto que garante isso.
    const mesa = umaMesa({
      player1_id: 'p1',
      player2_id: 'p2',
      player3_id: 'p3',
      player4_id: 'p4',
      p1_name: 'Ana',
      p2_name: 'Bruno',
      p3_name: 'Carla',
      p4_name: 'Diego',
    });
    const pod = montar(
      { pod_size: 4, async_draws: 1 },
      { round: umaRodada(), pairing: mesa, myPlayer: eu },
    );
    await pod.whenStable();
    const botoesPod = [...(pod.nativeElement as HTMLElement).querySelectorAll('button')].map((b) =>
      b.textContent?.trim(),
    );

    expect(botoesPod).toContain('I Won');
    expect(botoesPod).not.toContain('I Lost');

    const duelo = montar(
      { pod_size: 2, async_draws: 1 },
      { round: umaRodada(), pairing: umaMesa(), myPlayer: eu },
    );
    await duelo.whenStable();
    const botoesDuelo = [...(duelo.nativeElement as HTMLElement).querySelectorAll('button')].map(
      (b) => b.textContent?.trim(),
    );

    expect(botoesDuelo).toContain('I Lost');
  });

  it('reportar emite a mesa e o resultado, sem falar com o servidor', async () => {
    const fixture = montar(
      { pod_size: 2 },
      { round: umaRodada(), pairing: umaMesa({ id: 'mesa-7' }), myPlayer: eu },
    );
    await fixture.whenStable();

    const emitidos: { pairingId: string; result: string }[] = [];
    fixture.componentInstance.report.subscribe((e) => emitidos.push(e));
    fixture.componentInstance.reportar('mesa-7', 'player1');

    expect(emitidos).toEqual([{ pairingId: 'mesa-7', result: 'player1' }]);
  });
});
