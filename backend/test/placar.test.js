/**
 * O placar por games e a regra que o liga ao resultado.
 *
 * A regra da loja: o placar DIZ o resultado. Quem fez mais games venceu, placar
 * igual é empate. Os dois primeiros testes de "contradição" são regressões de
 * defeitos que a rota aceitava antes desta lib existir.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { resultadoDoPlacar, conferirPlacar, rotuloDoPlacar, ehPlacarConhecido } = require('../src/lib/placar');
const { computeStandings } = require('../src/services/standings');

const duelo = (extra = {}) => ({ result: 'player1', ehDuelo: true, ...extra });

// --- A regra ---

test('o placar diz o resultado: quem fez mais games venceu', () => {
  assert.equal(resultadoDoPlacar(2, 0), 'player1');
  assert.equal(resultadoDoPlacar(2, 1), 'player1');
  assert.equal(resultadoDoPlacar(1, 0), 'player1');
  assert.equal(resultadoDoPlacar(0, 2), 'player2');
  assert.equal(resultadoDoPlacar(1, 2), 'player2');
  assert.equal(resultadoDoPlacar(0, 1), 'player2');
});

test('placar igual é empate — 1-1 e 0-0', () => {
  assert.equal(resultadoDoPlacar(1, 1), 'draw');
  assert.equal(resultadoDoPlacar(0, 0), 'draw');
});

test('os cinco placares são os aceitos, nos dois sentidos', () => {
  for (const [a, b] of [[2, 0], [2, 1], [1, 0], [1, 1], [0, 0], [0, 2], [1, 2], [0, 1]]) {
    assert.equal(ehPlacarConhecido(a, b), true, `${a}-${b} devia ser aceito`);
  }
  // 2-2 seria uma partida de quatro games; 3-0 e 5-1 não existem em melhor de três.
  for (const [a, b] of [[2, 2], [3, 0], [5, 1], [9, 9], [3, 2]]) {
    assert.equal(ehPlacarConhecido(a, b), false, `${a}-${b} não devia ser aceito`);
  }
});

// --- As duas contradições que a rota aceitava ---

test('REGRESSÃO: vencedor da partida não pode ter MENOS games', () => {
  // `result: 'player1'` com 0-2 passava pela rota antiga, que só conferia
  // "partida decidida não termina em placar igual". O GW% então creditava os
  // games a quem perdeu a partida.
  const erro = conferirPlacar(duelo({ result: 'player1', p1Games: 0, p2Games: 2 }));
  assert.ok(erro, 'devia recusar');
  assert.equal(erro.status, 400);
  assert.equal(erro.code, 'api.gameScoreMismatch');
});

test('REGRESSÃO: empate não pode ter placar desigual', () => {
  // `result: 'draw'` com 2-0 também passava. Não era alcançável pela tela de
  // então, que nunca mandava placar em empate — passaria a ser no instante em
  // que 1-1 e 0-0 fossem oferecidos.
  const erro = conferirPlacar(duelo({ result: 'draw', p1Games: 2, p2Games: 0 }));
  assert.ok(erro, 'devia recusar');
  assert.equal(erro.code, 'api.gameScoreMismatch');
});

// --- O que passa ---

test('os cinco placares passam com o resultado que eles derivam', () => {
  const casos = [
    [2, 0, 'player1'], [2, 1, 'player1'], [1, 0, 'player1'],
    [0, 2, 'player2'], [1, 2, 'player2'], [0, 1, 'player2'],
    [1, 1, 'draw'], [0, 0, 'draw'],
  ];
  for (const [p1, p2, result] of casos) {
    assert.equal(conferirPlacar(duelo({ result, p1Games: p1, p2Games: p2 })), null, `${p1}-${p2} → ${result}`);
  }
});

test('sem placar, nada a conferir — o placar continua opcional', () => {
  assert.equal(conferirPlacar({ result: 'player1', ehDuelo: true }), null);
  assert.equal(conferirPlacar({ result: 'draw', ehDuelo: false }), null);
  // Um lado só não é placar: a rota trata como "não informado".
  assert.equal(conferirPlacar({ result: 'player1', p1Games: 2, ehDuelo: true }), null);
});

test('mesa de três ou quatro não tem placar por games', () => {
  const erro = conferirPlacar({ result: 'player1', p1Games: 2, p2Games: 0, ehDuelo: false });
  assert.ok(erro);
  assert.equal(erro.code, 'api.gameScoreDuelOnly');
});

test('placar fora do conjunto é recusado antes de virar resultado', () => {
  const erro = conferirPlacar(duelo({ result: 'player1', p1Games: 3, p2Games: 0 }));
  assert.ok(erro);
  assert.equal(erro.code, 'api.gameScoreInvalid');
});

test('rótulo: mostra o placar, ou nada quando não há', () => {
  assert.equal(rotuloDoPlacar(2, 1), '2-1');
  assert.equal(rotuloDoPlacar(0, 0), '0-0');
  assert.equal(rotuloDoPlacar(null, null), null);
  assert.equal(rotuloDoPlacar(undefined, undefined), null);
  assert.equal(rotuloDoPlacar(2, null), null);
});

// --- O que cada placar faz no GW% (MTR Appendix C) ---

const EVENTO = { points_win: 3, points_draw: 1, points_loss: 0 };
const jog = (id) => ({ id, display_name: id.toUpperCase(), status: 'active' });
const mesa = (result, g1, g2) => ({
  round_id: 'r1', player1_id: 'a', player2_id: 'b', player3_id: null, player4_id: null,
  result, result_status: 'confirmed', p1_games: g1, p2_games: g2,
});
const gw = (result, g1, g2) => {
  const rows = computeStandings([jog('a'), jog('b')], [mesa(result, g1, g2)], EVENTO);
  return { a: rows.find((p) => p.id === 'a').gwp, b: rows.find((p) => p.id === 'b').gwp };
};
const perto = (v, esperado, msg) =>
  assert.ok(Math.abs(v - esperado) < 1e-9, `${msg}: ${v} ≠ ${esperado}`);

test('GW% de cada placar sai por game points, como manda a Appendix C', () => {
  // 3 pontos de game por game ganho, sobre 3x os games jogados; piso de 33%.
  perto(gw('player1', 2, 0).a, 1, '2-0 do vencedor');
  perto(gw('player1', 2, 1).a, 6 / 9, '2-1 do vencedor');
  perto(gw('player1', 2, 1).b, 1 / 3, '2-1 do perdedor');
  perto(gw('player1', 1, 0).a, 1, '1-0 do vencedor');
  perto(gw('draw', 1, 1).a, 0.5, '1-1');
  perto(gw('draw', 1, 1).b, 0.5, '1-1 do outro lado');
});

test('0-0 grava o empate e não entra no GW%', () => {
  // Zero games decididos: não há o que dividir, e a coluna mostra "—". O
  // refinamento do MTR ("unfinished games are considered draws") exigiria saber
  // que houve um game começado, e o banco guarda games GANHOS — um 0-0 não
  // distingue "deu tempo no primeiro game" de "a partida não começou".
  const rows = computeStandings([jog('a'), jog('b')], [mesa('draw', 0, 0)], EVENTO);
  const a = rows.find((p) => p.id === 'a');
  assert.equal(a.gwp, null, 'o 0-0 não devia produzir GW%');
  assert.equal(a.points, 1, 'mas o empate vale 1 ponto de match');
  assert.equal(a.draws, 1);
});
