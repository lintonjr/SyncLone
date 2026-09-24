import { emCentavos, parteDaProposta } from './proposta';

/**
 * Os casos são os mesmos de `backend/test/avaliacao.test.js` de propósito: a
 * prévia só serve se combinar com o que o servidor vai gravar. Se uma das duas
 * pontas mudar de regra, é aqui que se descobre.
 */
describe('proposta — a prévia combina com o servidor', () => {
  it('lê vírgula e ponto, e recusa o que não é valor', () => {
    expect(emCentavos(300)).toBe(30000);
    expect(emCentavos('33.33')).toBe(3333);
    expect(emCentavos('33,33')).toBe(3333);
    expect(emCentavos('0.05')).toBe(5);
    for (const ruim of ['abc', '-10', '10.999', '', null, undefined]) {
      expect(emCentavos(ruim)).toBeNull();
    }
  });

  it('60% e 50% de R$ 300,00', () => {
    expect(parteDaProposta(300, 60)).toBe('180.00');
    expect(parteDaProposta(300, 50)).toBe('150.00');
  });

  it('a metade de um centavo fica com o cliente, não com a loja', () => {
    // 33,33 a 50% = 16,665 → 16,67. Truncar daria 16,66 e a diferença seria da loja.
    expect(parteDaProposta('33.33', 50)).toBe('16.67');
    expect(parteDaProposta('33.33', 60)).toBe('20.00');
    expect(parteDaProposta('0.03', 50)).toBe('0.02');
  });

  it('percentual negociado sai calculado igual', () => {
    expect(parteDaProposta(200, 55)).toBe('110.00');
    expect(parteDaProposta(200, 45)).toBe('90.00');
    expect(parteDaProposta(1500, 72)).toBe('1080.00');
  });

  it('sem valor ou sem percentual válido, não há prévia — e nunca "NaN"', () => {
    expect(parteDaProposta(0, 60)).toBe('');
    expect(parteDaProposta('grátis', 60)).toBe('');
    expect(parteDaProposta('', 60)).toBe('');
    for (const pct of [0, 101, 60.5, null, undefined, NaN]) {
      expect(parteDaProposta(300, pct)).toBe('');
    }
  });
});
