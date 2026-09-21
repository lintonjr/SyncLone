const test = require('node:test');
const assert = require('node:assert');
const { jogadoresQueAvancam } = require('../src/services/pairing');

/** Mesa do mata-mata, só com o que a regra olha: quem sentou nela. */
const mesa = (...ids) => ({
  player1_id: ids[0] ?? null,
  player2_id: ids[1] ?? null,
  player3_id: ids[2] ?? null,
  player4_id: ids[3] ?? null,
});

// Classificação oficial do suíço, melhor primeiro.
const ORDEM = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

test('avanço: Commander Top 8 vira final de QUATRO, não de dois', () => {
  // O defeito relatado: duas mesas de quatro produziam dois vencedores e a final
  // saía com dois jogadores.
  const avancam = jogadoresQueAvancam({
    mesas: [mesa('p1', 'p4', 'p5', 'p8'), mesa('p2', 'p3', 'p6', 'p7')],
    vencedores: ['p5', 'p7'],
    ordemOficial: ORDEM,
    podSize: 4,
  });

  assert.equal(avancam.length, 4);
  // Os dois vencedores, mais o melhor classificado de cada mesa entre os que perderam.
  assert.deepEqual(avancam, ['p1', 'p2', 'p5', 'p7']);
});

test('avanço: um de cada mesa antes de repetir mesa', () => {
  // Sem o rodízio, as duas vagas sairiam da mesma mesa (p1 e p4 são os melhores
  // classificados entre os perdedores) e uma mesa inteira ficaria sem
  // representante na final.
  const avancam = jogadoresQueAvancam({
    mesas: [mesa('p1', 'p4', 'p7', 'p8'), mesa('p2', 'p3', 'p5', 'p6')],
    vencedores: ['p7', 'p5'],
    ordemOficial: ORDEM,
    podSize: 4,
  });
  assert.deepEqual(avancam, ['p1', 'p2', 'p5', 'p7']);
});

test('avanço: quando os vencedores já enchem a mesa, ninguém mais sobe', () => {
  // Top 16 em mesa de quatro: quatro mesas, quatro vencedores, final cheia — o
  // comportamento de hoje, que continua igual.
  const ordem = Array.from({ length: 16 }, (_, i) => `j${i + 1}`);
  const mesas = [
    mesa('j1', 'j8', 'j9', 'j16'),
    mesa('j2', 'j7', 'j10', 'j15'),
    mesa('j3', 'j6', 'j11', 'j14'),
    mesa('j4', 'j5', 'j12', 'j13'),
  ];
  const avancam = jogadoresQueAvancam({
    mesas,
    vencedores: ['j9', 'j2', 'j11', 'j4'],
    ordemOficial: ordem,
    podSize: 4,
  });
  // Ordem das mesas, preservada: é o caminho do chaveamento, não uma reclassificação.
  assert.deepEqual(avancam, ['j9', 'j2', 'j11', 'j4']);
});

test('avanço: duelo continua sendo só o vencedor', () => {
  const avancam = jogadoresQueAvancam({
    mesas: [mesa('p1', 'p8'), mesa('p2', 'p7'), mesa('p3', 'p6'), mesa('p4', 'p5')],
    vencedores: ['p1', 'p7', 'p3', 'p4'],
    ordemOficial: ORDEM,
    podSize: 2,
  });
  assert.deepEqual(avancam, ['p1', 'p7', 'p3', 'p4']);
});

test('avanço: um vencedor só é campeão — nada a completar', () => {
  assert.deepEqual(
    jogadoresQueAvancam({ mesas: [mesa('p1', 'p2', 'p3', 'p4')], vencedores: ['p3'], ordemOficial: ORDEM, podSize: 4 }),
    ['p3'],
  );
});

test('avanço: sem candidatos suficientes, a mesa vai incompleta em vez de inventar gente', () => {
  // Top 4 em mesa de quatro com uma mesa só de três: dois vencedores impossíveis;
  // aqui o caso é uma fase com duas mesas pequenas.
  const avancam = jogadoresQueAvancam({
    mesas: [mesa('p1', 'p2'), mesa('p3', 'p4')],
    vencedores: ['p1', 'p4'],
    ordemOficial: ORDEM,
    podSize: 4,
  });
  assert.deepEqual(avancam, ['p1', 'p2', 'p3', 'p4']);
});

test('avanço: quem avança sai na ordem da classificação, para o chaveamento seguinte', () => {
  const avancam = jogadoresQueAvancam({
    mesas: [mesa('p4', 'p5', 'p6', 'p8'), mesa('p1', 'p2', 'p3', 'p7')],
    vencedores: ['p8', 'p3'],
    ordemOficial: ORDEM,
    podSize: 4,
  });
  // p1 (melhor perdedor da segunda mesa) e p4 (da primeira) entram, e a lista sai ordenada.
  assert.deepEqual(avancam, ['p1', 'p3', 'p4', 'p8']);
});
