const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStandings } = require('../src/services/standings');

const EVENT = { points_win: 3, points_draw: 1, points_loss: 0 };
const FLOOR = 1 / 3;
const close = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: ${actual} ≠ ${expected}`);

const player = (id, points, extra = {}) => ({ id, display_name: id.toUpperCase(), points, ...extra });

// Mesa 1v1 confirmada. `winner` é 'player1' | 'player2' | 'draw'.
const match = (p1, p2, winner, games) => ({
  player1_id: p1, player2_id: p2, player3_id: null, player4_id: null,
  result: winner, result_status: 'confirmed',
  p1_games: games ? games[0] : null,
  p2_games: games ? games[1] : null,
});

const bye = (p1) => ({
  player1_id: p1, player2_id: null, player3_id: null, player4_id: null,
  result: 'bye', result_status: 'confirmed', p1_games: null, p2_games: null,
});

test('MWP: 2 de 3 vitórias dá 66,7%', () => {
  const players = [player('a', 6), player('b', 0), player('c', 0), player('d', 0)];
  const pairings = [match('a', 'b', 'player1'), match('a', 'c', 'player1'), match('a', 'd', 'player2')];
  const [a] = computeStandings(players, pairings, EVENT);
  close(a.mwp, 6 / 9, 'MWP de A');
  assert.equal(a.matches_played, 3);
});

test('MWP tem piso de 33% — quem perdeu tudo não afunda o OMW% dos adversários', () => {
  const players = [player('a', 3), player('b', 0)];
  const pairings = [match('a', 'b', 'player1')];
  const rows = computeStandings(players, pairings, EVENT);
  const b = rows.find((p) => p.id === 'b');
  close(b.mwp, FLOOR, 'MWP do perdedor');
  // ...e é esse piso que A recebe como OMW%, não 0.
  const a = rows.find((p) => p.id === 'a');
  close(a.omw, FLOOR, 'OMW% de A');
});

test('OMW%: média dos adversários enfrentados, não dos pontos deles', () => {
  // A venceu B (que ganhou as outras duas) e venceu C (que perdeu as outras duas).
  const players = [player('a', 6), player('b', 6), player('c', 0), player('d', 3), player('e', 3)];
  const pairings = [
    match('a', 'b', 'player1'),
    match('a', 'c', 'player1'),
    match('b', 'd', 'player1'),
    match('b', 'e', 'player1'),
    match('c', 'd', 'player2'),
    match('c', 'e', 'player2'),
  ];
  const a = computeStandings(players, pairings, EVENT).find((p) => p.id === 'a');
  // B: 2 de 3 = 6/9. C: 0 de 3 → piso 1/3.
  close(a.omw, (6 / 9 + FLOOR) / 2, 'OMW% de A');
});

test('bye conta como rodada jogada, mas não entra no OMW% de ninguém', () => {
  const players = [player('a', 3), player('b', 0)];
  const rows = computeStandings(players, [bye('a')], EVENT);
  const a = rows.find((p) => p.id === 'a');
  assert.equal(a.matches_played, 1);
  close(a.mwp, 1, 'MWP de quem levou bye');
  assert.equal(a.omw, null, 'bye não gera adversário');
});

test('GW%: usa o placar por games quando registrado', () => {
  const players = [player('a', 3), player('b', 0)];
  const rows = computeStandings(players, [match('a', 'b', 'player1', [2, 1])], EVENT);
  const a = rows.find((p) => p.id === 'a');
  const b = rows.find((p) => p.id === 'b');
  close(a.gwp, 2 / 3, 'GW% do vencedor');
  close(b.gwp, FLOOR, 'GW% do perdedor (1 de 3, abaixo do piso)');
});

test('GW%: sem placar registrado, fica nulo e não desempata', () => {
  const players = [player('a', 3), player('b', 0)];
  const rows = computeStandings(players, [match('a', 'b', 'player1')], EVENT);
  assert.equal(rows.find((p) => p.id === 'a').gwp, null);
  assert.equal(rows.find((p) => p.id === 'a').ogw, null);
});

test('GW%: bye vale 2-0', () => {
  const rows = computeStandings([player('a', 3)], [bye('a')], EVENT);
  close(rows[0].gwp, 1, 'GW% do bye');
});

test('resultado pendente de aprovação não move desempate nenhum', () => {
  const players = [player('a', 0), player('b', 0)];
  const pending = { ...match('a', 'b', 'player1'), result_status: 'pending' };
  const rows = computeStandings(players, [pending], EVENT);
  assert.equal(rows[0].matches_played, 0);
  close(rows[0].mwp, FLOOR, 'MWP sem partida confirmada');
});

test('ordena por pontos e, no empate, por OMW%', () => {
  // A e B têm 3 pontos cada; A venceu quem venceu o resto, B venceu quem perdeu tudo.
  const players = [player('a', 3), player('b', 3), player('strong', 6), player('weak', 0)];
  const pairings = [
    match('a', 'strong', 'player1'),
    match('b', 'weak', 'player1'),
    match('strong', 'weak', 'player1'),
    match('strong', 'b', 'player1'),
  ];
  const rows = computeStandings(players, pairings, EVENT);
  const order = rows.map((p) => p.id);
  assert.equal(order[0], 'strong', 'mais pontos vem primeiro');
  assert.ok(order.indexOf('a') < order.indexOf('b'), 'no empate de pontos, maior OMW% na frente');
});

test('empate total é resolvido pelo nome, para a ordem não dançar entre requests', () => {
  const players = [player('zeta', 0), player('alfa', 0)];
  const twice = [computeStandings(players, [], EVENT), computeStandings(players, [], EVENT)];
  assert.deepEqual(twice[0].map((p) => p.id), ['alfa', 'zeta']);
  assert.deepEqual(twice[0].map((p) => p.id), twice[1].map((p) => p.id));
});

test('jogador dropado continua contando como adversário de quem ficou', () => {
  const players = [player('a', 3), player('gone', 0, { status: 'dropped' })];
  const rows = computeStandings(players, [match('a', 'gone', 'player1')], EVENT);
  const a = rows.find((p) => p.id === 'a');
  assert.equal(a.matches_played, 1);
  close(a.omw, FLOOR, 'OMW% considera o dropado');
});

test('pod multiplayer: todos os podmates viram adversários', () => {
  const players = [player('a', 3), player('b', 0), player('c', 0), player('d', 0)];
  const pod = {
    player1_id: 'a', player2_id: 'b', player3_id: 'c', player4_id: 'd',
    result: 'player1', result_status: 'confirmed', p1_games: null, p2_games: null,
  };
  const rows = computeStandings(players, [pod], EVENT);
  const a = rows.find((p) => p.id === 'a');
  assert.equal(a.matches_played, 1);
  close(a.mwp, 1, 'venceu o pod');
  close(a.omw, FLOOR, 'três adversários no piso');
  const b = rows.find((p) => p.id === 'b');
  close(b.mwp, FLOOR, 'perdedor no piso');
});

test('respeita a pontuação configurada do evento', () => {
  const custom = { points_win: 4, points_draw: 2, points_loss: 1 };
  const players = [player('a', 6), player('b', 3)];
  const rows = computeStandings(players, [match('a', 'b', 'draw')], custom);
  // Empate vale 2 de 4 possíveis.
  close(rows.find((p) => p.id === 'a').mwp, 0.5, 'MWP com pontuação custom');
});
