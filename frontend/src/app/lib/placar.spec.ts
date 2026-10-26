import {
  EMPATES,
  VITORIAS,
  placarPorAssento,
  resultadoDoPlacar,
  rotuloDoPlacar,
} from './placar';

/**
 * Este arquivo é a metade cliente de uma regra que vive nos dois lados. A outra
 * é `backend/test/placar.test.js`, e os casos são deliberadamente os mesmos: se
 * um dia as duas implementações divergirem, é um destes testes que avisa, não o
 * organizador no balcão descobrindo que o botão mandou o placar trocado.
 */
describe('placar por games', () => {
  it('o placar diz o resultado: quem fez mais games venceu', () => {
    expect(resultadoDoPlacar(2, 0)).toBe('player1');
    expect(resultadoDoPlacar(2, 1)).toBe('player1');
    expect(resultadoDoPlacar(1, 0)).toBe('player1');
    expect(resultadoDoPlacar(0, 2)).toBe('player2');
    expect(resultadoDoPlacar(1, 2)).toBe('player2');
    expect(resultadoDoPlacar(0, 1)).toBe('player2');
  });

  it('placar igual é empate — 1-1 e 0-0', () => {
    expect(resultadoDoPlacar(1, 1)).toBe('draw');
    expect(resultadoDoPlacar(0, 0)).toBe('draw');
  });

  it('oferece os cinco placares: três de vitória e dois de empate', () => {
    expect(VITORIAS.map((o) => o.label)).toEqual(['2-0', '2-1', '1-0']);
    expect(EMPATES.map((o) => o.label)).toEqual(['1-1', '0-0']);
  });

  it('traduz para assentos de acordo com quem fez o placar', () => {
    const doisUm = VITORIAS[1];
    expect(doisUm.label).toBe('2-1');
    // O assento 1 venceu: ele fica com os 2.
    expect(placarPorAssento(doisUm, true)).toEqual({ p1: 2, p2: 1 });
    // O assento 2 venceu: os 2 vão para o outro lado. É esta inversão que a
    // tela antiga fazia à mão, e que não sabia fazer para empate.
    expect(placarPorAssento(doisUm, false)).toEqual({ p1: 1, p2: 2 });
  });

  it('empate sai igual dos dois lados, qualquer que seja o assento', () => {
    for (const op of EMPATES) {
      expect(placarPorAssento(op, true)).toEqual(placarPorAssento(op, false));
    }
  });

  it('todo placar oferecido deriva o resultado que a tela promete', () => {
    for (const op of VITORIAS) {
      const comoP1 = placarPorAssento(op, true);
      expect(resultadoDoPlacar(comoP1.p1, comoP1.p2)).toBe('player1');
      const comoP2 = placarPorAssento(op, false);
      expect(resultadoDoPlacar(comoP2.p1, comoP2.p2)).toBe('player2');
    }
    for (const op of EMPATES) {
      const g = placarPorAssento(op, true);
      expect(resultadoDoPlacar(g.p1, g.p2)).toBe('draw');
    }
  });

  it('rótulo do placar já gravado, ou nada quando não há', () => {
    expect(rotuloDoPlacar(2, 1)).toBe('2-1');
    expect(rotuloDoPlacar(0, 0)).toBe('0-0');
    expect(rotuloDoPlacar(null, null)).toBeNull();
    expect(rotuloDoPlacar(undefined, undefined)).toBeNull();
    expect(rotuloDoPlacar(2, null)).toBeNull();
  });
});
