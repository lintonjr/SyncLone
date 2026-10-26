import { TestBed } from '@angular/core/testing';
import { EventResultComponent, ResultadoEscolhido } from './event-result';
import { umaMesa } from '../../testing/fixtures';
import { Pairing } from '../../services/event';

/**
 * O modal de lançar resultado. Não tinha teste nenhum até aqui, e passou a ter
 * quando deixou de oferecer dois placares para oferecer cinco — é justamente a
 * tela onde um botão trocado grava o vencedor errado na classificação.
 */
function montar(mesa: Partial<Pairing> = {}, isPodMode = false) {
  const fixture = TestBed.createComponent(EventResultComponent);
  fixture.componentRef.setInput('mesa', umaMesa(mesa));
  fixture.componentRef.setInput('isPodMode', isPodMode);
  fixture.detectChanges();
  return fixture;
}

const chips = (fixture: { nativeElement: unknown }) =>
  [...(fixture.nativeElement as HTMLElement).querySelectorAll('.game-chip')].map((b) =>
    b.textContent?.trim(),
  );

describe('EventResultComponent', () => {
  it('em duelo oferece os cinco placares: um lado, o outro, e o empate', async () => {
    const fixture = montar();
    await fixture.whenStable();
    // 2-0, 2-1, 1-0 para cada jogador; 1-1 e 0-0 no empate.
    expect(chips(fixture)).toEqual(['2-0', '2-1', '1-0', '2-0', '2-1', '1-0', '1-1', '0-0']);
  });

  it('mesa de quatro não tem placar por games', async () => {
    const pod = montar({ player3_id: 'p3', player4_id: 'p4', p3_name: 'C', p4_name: 'D' }, true);
    await pod.whenStable();
    expect(chips(pod)).toEqual([]);
  });

  it('o placar escolhido vai para os assentos certos, com o resultado que ele deriva', async () => {
    const fixture = montar({ id: 'mesa-3' });
    await fixture.whenStable();
    const emitidos: ResultadoEscolhido[] = [];
    fixture.componentInstance.lancar.subscribe((e) => emitidos.push(e));

    const doisUm = fixture.componentInstance.vitorias[1];
    fixture.componentInstance.escolherComPlacar('player1', doisUm);
    fixture.componentInstance.escolherComPlacar('player2', doisUm);
    fixture.componentInstance.escolherComPlacar('draw', fixture.componentInstance.empates[1]);

    expect(emitidos).toEqual([
      { pairingId: 'mesa-3', resultado: 'player1', games: { p1: 2, p2: 1 } },
      { pairingId: 'mesa-3', resultado: 'player2', games: { p1: 1, p2: 2 } },
      { pairingId: 'mesa-3', resultado: 'draw', games: { p1: 0, p2: 0 } },
    ]);
  });

  it('o caminho sem placar continua existindo, e manda games nulo', async () => {
    const fixture = montar({ id: 'mesa-4' });
    await fixture.whenStable();
    const emitidos: ResultadoEscolhido[] = [];
    fixture.componentInstance.lancar.subscribe((e) => emitidos.push(e));

    fixture.componentInstance.escolher('draw');

    expect(emitidos).toEqual([{ pairingId: 'mesa-4', resultado: 'draw', games: null }]);
  });

  it('editando, destaca o placar que já está gravado — e só ele', async () => {
    // Mesa já lançada como 2-1 para o assento 1.
    const fixture = montar({ result: 'player1', p1_games: 2, p2_games: 1 });
    await fixture.whenStable();

    const inst = fixture.componentInstance;
    expect(inst.placarAtual()).toBe('2-1');
    expect(inst.ehAtual('player1', inst.vitorias[1])).toBe(true); // 2-1 de quem venceu
    expect(inst.ehAtual('player1', inst.vitorias[0])).toBe(false); // 2-0 não
    expect(inst.ehAtual('player2', inst.vitorias[1])).toBe(false); // nem do outro lado
  });

  it('resultado gravado sem placar não acende nenhum chip', async () => {
    const fixture = montar({ result: 'draw', p1_games: null, p2_games: null });
    await fixture.whenStable();
    const inst = fixture.componentInstance;
    expect(inst.placarAtual()).toBeNull();
    for (const op of inst.empates) expect(inst.ehAtual('draw', op)).toBe(false);
  });
});
