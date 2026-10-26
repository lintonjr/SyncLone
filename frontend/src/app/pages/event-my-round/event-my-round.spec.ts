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

  // --- Auto-report com placar: o jogador reporta o que o organizador reporta ---

  it('em duelo o jogador vê os cinco placares, dos dois lados e do empate', async () => {
    const fixture = montar(
      { pod_size: 2, async_draws: 1 },
      { round: umaRodada(), pairing: umaMesa(), myPlayer: eu },
    );
    await fixture.whenStable();
    const chips = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('.self-report-placar .game-chip'),
    ].map((b) => b.textContent?.trim());

    // 2-0, 2-1 e 1-0 para "eu venci" e outra vez para "eu perdi"; 1-1 e 0-0 no empate.
    expect(chips).toEqual(['2-0', '2-1', '1-0', '2-0', '2-1', '1-0', '1-1', '0-0']);
  });

  it('mesa de quatro não oferece placar: "2×1" não quer dizer nada num pod', async () => {
    const pod = umaMesa({ player3_id: 'p3', player4_id: 'p4', p3_name: 'C', p4_name: 'D' });
    const fixture = montar(
      { pod_size: 4, async_draws: 1 },
      { round: umaRodada(), pairing: pod, myPlayer: eu },
    );
    await fixture.whenStable();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.self-report-placar'),
    ).toBeNull();
  });

  it('o placar que o jogador escolhe vai nos assentos certos', async () => {
    const fixture = montar(
      { pod_size: 2, async_draws: 1 },
      { round: umaRodada(), pairing: umaMesa({ id: 'mesa-9' }), myPlayer: eu },
    );
    await fixture.whenStable();
    const emitidos: { pairingId: string; result: string; games?: { p1: number; p2: number } }[] = [];
    fixture.componentInstance.report.subscribe((e) => emitidos.push(e));

    const doisUm = fixture.componentInstance.vitorias[1];
    // Eu (assento 1) venci por 2-1.
    fixture.componentInstance.reportarComPlacar('player1', doisUm);
    // Perdi por 2-1: os dois games vão para o assento 2.
    fixture.componentInstance.reportarComPlacar('player2', doisUm);
    // Empate 1-1.
    fixture.componentInstance.reportarComPlacar('draw', fixture.componentInstance.empates[0]);

    expect(emitidos).toEqual([
      { pairingId: 'mesa-9', result: 'player1', games: { p1: 2, p2: 1 } },
      { pairingId: 'mesa-9', result: 'player2', games: { p1: 1, p2: 2 } },
      { pairingId: 'mesa-9', result: 'draw', games: { p1: 1, p2: 1 } },
    ]);
  });

  it('os três botões sem placar continuam lá, para quem não acompanha games', async () => {
    const fixture = montar(
      { pod_size: 2, async_draws: 1 },
      { round: umaRodada(), pairing: umaMesa(), myPlayer: eu },
    );
    await fixture.whenStable();
    const botoes = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('.self-report-actions button'),
    ].map((b) => b.textContent?.trim());

    expect(botoes).toContain('I Won');
    expect(botoes).toContain('I Lost');
    expect(botoes).toContain('Report Draw');
  });
});
