const test = require('node:test');
const assert = require('node:assert/strict');
const { generateClanPairings, seedClanPlayoffPods } = require('../src/services/pairing');

// n clãs de 4 jogadores. Pontos decrescentes para a ordem por desempenho ser previsível.
function field(n) {
  const clans = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  return clans.flatMap((c, ci) =>
    [1, 2, 3, 4].map((k) => ({
      id: `${c}${k}`,
      clan_id: c,
      display_name: `${c}${k}`,
      points: (n - ci) * 3 + (4 - k),
    }))
  );
}

const seatsOf = (pod) => [pod.player1, pod.player2, pod.player3, pod.player4].filter(Boolean);
const pairsIn = (arr) => arr.flatMap((v, i) => arr.slice(i + 1).map((w) => [v, w]));

// Um pareamento anterior, no formato que o banco devolve.
const asPast = (pods) => pods.map((p) => ({
  player1_id: p.player1?.id ?? null,
  player2_id: p.player2?.id ?? null,
  player3_id: p.player3?.id ?? null,
  player4_id: p.player4?.id ?? null,
  result: null,
}));

function assertEstrutura(pods, players, msg = '') {
  // toda mesa tem 4 jogadores de 4 clãs diferentes
  for (const pod of pods) {
    const seats = seatsOf(pod);
    assert.equal(seats.length, 4, `${msg} mesa sem 4 jogadores`);
    const clans = new Set(seats.map((p) => p.clan_id));
    assert.equal(clans.size, 4, `${msg} mesa com clã repetido: ${seats.map((s) => s.id)}`);
  }
  // todo jogador joga exatamente uma vez
  const ids = pods.flatMap(seatsOf).map((p) => p.id);
  assert.equal(ids.length, players.length, `${msg} contagem de assentos`);
  assert.deepEqual([...ids].sort(), players.map((p) => p.id).sort(), `${msg} jogadores repetidos ou faltando`);
}

const METODOS = ['swiss', 'swiss-less-repetition', 'avoid-repetition', 'random'];

for (const n of [4, 5, 6, 7, 8]) {
  test(`clã fronto: ${n} clãs formam mesas válidas em todos os métodos`, () => {
    for (const method of METODOS) {
      const players = field(n);
      const pods = generateClanPairings(players, method, []);
      assert.equal(pods.length, n, `${method}: número de mesas`);
      assertEstrutura(pods, players, `${method}:`);
    }
  });
}

test('clã fronto: nunca sobra ninguém sem mesa, mesmo repetindo muitas vezes', () => {
  // O risco real do algoritmo é terminar a rodada com 4 sobras do mesmo clã.
  for (let i = 0; i < 40; i++) {
    for (const n of [4, 5, 7]) {
      const players = field(n);
      assertEstrutura(generateClanPairings(players, 'random', []), players, `n=${n}`);
    }
  }
});

test('clã fronto: 4 clãs colocam um jogador de cada clã em toda mesa', () => {
  // Com exatamente 4 clãs não existe outra configuração possível.
  const players = field(4);
  const pods = generateClanPairings(players, 'swiss', []);
  for (const pod of pods) {
    assert.deepEqual(seatsOf(pod).map((p) => p.clan_id).sort(), ['A', 'B', 'C', 'D']);
  }
});

// Reencontros das tabelas de refer&#234;ncia da pasta clafronto, medidos: 4 cl&#227;s = 0,
// 5 = 18, 6 = 17, 7 = 20. S&#227;o modelos feitos &#224; m&#227;o, e servem de r&#233;gua.
const REFERENCIA = { 4: 0, 5: 18, 6: 17, 7: 20 };

function reencontrosEm4Rodadas(n) {
  const players = field(n);
  let past = [];
  for (let round = 0; round < 4; round++) {
    const pods = generateClanPairings(players, 'swiss-less-repetition', past, 200, round);
    assertEstrutura(pods, players, `n=${n} r=${round + 1}`);
    past = past.concat(asPast(pods));
  }
  const encontros = new Map();
  for (const p of past) {
    const seats = [p.player1_id, p.player2_id, p.player3_id, p.player4_id].filter(Boolean).sort();
    for (const [a, b] of pairsIn(seats)) {
      const k = `${a}|${b}`;
      encontros.set(k, (encontros.get(k) ?? 0) + 1);
    }
  }
  return [...encontros.values()].filter((v) => v > 1).length;
}

test('4 cl&#227;s: 4 rodadas sem nenhum reencontro, sempre', () => {
  // Caso exato: a rota&#231;&#227;o por quadrados latinos garante que cada jogador enfrenta
  // os seus 12 advers&#225;rios poss&#237;veis uma vez cada. N&#227;o depende de sorte.
  for (let i = 0; i < 15; i++) {
    assert.equal(reencontrosEm4Rodadas(4), 0, 'a rota&#231;&#227;o de 4 cl&#227;s deve ser exata');
  }
});

test('5 a 7 cl&#227;s: muito abaixo do que as tabelas de refer&#234;ncia deixam', () => {
  // Medido em 50 execu&#231;&#245;es: m&#225;ximo observado 7, contra 17-20 das tabelas.
  // A r&#233;gua fica em 9 para o teste n&#227;o oscilar com o sorteio.
  for (const n of [5, 6, 7]) {
    const r = reencontrosEm4Rodadas(n);
    assert.ok(r <= 9, `${n} cl&#227;s: ${r} reencontros, acima do teto de 9`);
    assert.ok(r < REFERENCIA[n], `${n} cl&#227;s: ${r} n&#227;o melhora a tabela (${REFERENCIA[n]})`);
  }
});

test('clã fronto: adversário do próprio clã nunca aparece, em nenhuma rodada', () => {
  const players = field(6);
  let past = [];
  for (let round = 0; round < 5; round++) {
    const pods = generateClanPairings(players, 'avoid-repetition', past);
    for (const pod of pods) {
      const clans = seatsOf(pod).map((p) => p.clan_id);
      assert.equal(new Set(clans).size, 4, `rodada ${round + 1}: ${clans}`);
    }
    past = past.concat(asPast(pods));
  }
});

test('clã fronto: recusa campo que não fecha em mesas de 4', () => {
  const players = field(4).slice(0, 15);
  assert.throws(() => generateClanPairings(players, 'swiss', []), /m&#250;ltiplo de 4|múltiplo de 4/);
});

test('clã fronto: recusa menos de 4 clãs', () => {
  const players = field(3);
  assert.throws(() => generateClanPairings(players, 'swiss', []), /4 cl/);
});

// --- Playoff em duplas ---

const clanSeed = (name, p1, p2) => ({
  id: name,
  name,
  players: [{ id: p1, clan_id: name }, { id: p2, clan_id: name }],
});

test('playoff: 2 clãs formam uma única mesa, que é a final', () => {
  const pods = seedClanPlayoffPods([clanSeed('A', 'A1', 'A2'), clanSeed('B', 'B1', 'B2')]);
  assert.equal(pods.length, 1);
  const seats = seatsOf(pods[0]);
  assert.equal(seats.length, 4);
  assert.equal(new Set(seats.map((s) => s.clan_id)).size, 2, 'a mesa tem exatamente 2 clãs');
});

test('playoff: 4 clãs formam 2 mesas, cruzando melhor com pior', () => {
  const pods = seedClanPlayoffPods([
    clanSeed('A', 'A1', 'A2'), clanSeed('B', 'B1', 'B2'),
    clanSeed('C', 'C1', 'C2'), clanSeed('D', 'D1', 'D2'),
  ]);
  assert.equal(pods.length, 2);
  // 1º contra 4º, 2º contra 3º — os dois primeiros só se encontram na final
  assert.deepEqual(seatsOf(pods[0]).map((s) => s.clan_id).sort(), ['A', 'A', 'D', 'D']);
  assert.deepEqual(seatsOf(pods[1]).map((s) => s.clan_id).sort(), ['B', 'B', 'C', 'C']);
});

test('playoff: parceiros sentam separados na mesa, como numa mesa de verdade', () => {
  const pods = seedClanPlayoffPods([clanSeed('A', 'A1', 'A2'), clanSeed('B', 'B1', 'B2')]);
  const p = pods[0];
  assert.equal(p.player1.clan_id, p.player3.clan_id, 'assentos 1 e 3 são do mesmo clã');
  assert.equal(p.player2.clan_id, p.player4.clan_id, 'assentos 2 e 4 são do mesmo clã');
  assert.notEqual(p.player1.clan_id, p.player2.clan_id, 'vizinhos são adversários');
});

test('playoff: toda mesa tem exatamente 2 clãs, nunca 3 ou 4', () => {
  for (const n of [2, 4]) {
    const clans = Array.from({ length: n }, (_, i) => {
      const c = String.fromCharCode(65 + i);
      return clanSeed(c, `${c}1`, `${c}2`);
    });
    for (const pod of seedClanPlayoffPods(clans)) {
      assert.equal(new Set(seatsOf(pod).map((s) => s.clan_id)).size, 2);
    }
  }
});

// --- Classificação de clãs ---

const { computeStandings, computeClanStandings } = require('../src/services/standings');

const EVENTO = { points_win: 3, points_draw: 1, points_loss: 0 };

test('classificação de clãs: soma os pontos dos quatro membros', () => {
  const players = [
    { id: 'a1', clan_id: 'A', display_name: 'A1', points: 9, wins: 3, losses: 1, draws: 0, status: 'active' },
    { id: 'a2', clan_id: 'A', display_name: 'A2', points: 6, wins: 2, losses: 2, draws: 0, status: 'active' },
    { id: 'a3', clan_id: 'A', display_name: 'A3', points: 3, wins: 1, losses: 3, draws: 0, status: 'active' },
    { id: 'a4', clan_id: 'A', display_name: 'A4', points: 0, wins: 0, losses: 4, draws: 0, status: 'active' },
    { id: 'b1', clan_id: 'B', display_name: 'B1', points: 6, wins: 2, losses: 2, draws: 0, status: 'active' },
    { id: 'b2', clan_id: 'B', display_name: 'B2', points: 6, wins: 2, losses: 2, draws: 0, status: 'active' },
    { id: 'b3', clan_id: 'B', display_name: 'B3', points: 3, wins: 1, losses: 3, draws: 0, status: 'active' },
    { id: 'b4', clan_id: 'B', display_name: 'B4', points: 0, wins: 0, losses: 4, draws: 0, status: 'active' },
  ];
  const ranked = computeStandings(players, [], EVENTO);
  const clans = computeClanStandings(ranked, [{ id: 'A', name: 'Dragões' }, { id: 'B', name: 'Corvos' }]);

  // Dragões 9+6+3+0 = 18; Corvos 6+6+3+0 = 15
  assert.equal(clans[0].name, 'Dragões');
  assert.equal(clans[0].points, 18);
  assert.equal(clans[1].name, 'Corvos');
  assert.equal(clans[1].points, 15);
  assert.equal(clans[0].wins, 6, 'vitórias somadas dos quatro');
  assert.equal(clans[0].player_count, 4);
});

test('classificação de clãs: empate de pontos é decidido pelo desempate agregado', () => {
  // Os dois clãs somam o mesmo; A enfrentou adversários mais fortes.
  const jog = (id, clan, pts) => ({ id, clan_id: clan, display_name: id, points: pts, wins: 0, losses: 0, draws: 0, status: 'active' });
  const players = [
    jog('a1', 'A', 3), jog('a2', 'A', 3), jog('a3', 'A', 0), jog('a4', 'A', 0),
    jog('b1', 'B', 3), jog('b2', 'B', 3), jog('b3', 'B', 0), jog('b4', 'B', 0),
    jog('c1', 'C', 9), jog('c2', 'C', 0), jog('c3', 'C', 0), jog('c4', 'C', 0),
  ];
  // A enfrentou c1 (forte); B enfrentou c2 (fraco)
  const mesa = (p1, p2, p3, p4, vencedor) => ({
    player1_id: p1, player2_id: p2, player3_id: p3, player4_id: p4,
    result: vencedor, result_status: 'confirmed', p1_games: null, p2_games: null,
  });
  const pairings = [
    mesa('a1', 'c1', 'b3', 'b4', 'player1'),
    mesa('b1', 'c2', 'a3', 'a4', 'player1'),
    mesa('c1', 'a2', 'b2', 'c3', 'player1'),
  ];
  const ranked = computeStandings(players, pairings, EVENTO);
  const clans = computeClanStandings(ranked, [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }]);
  const a = clans.find((c) => c.name === 'A');
  const b = clans.find((c) => c.name === 'B');
  assert.ok(a.omw !== null && b.omw !== null, 'os dois clãs têm OMW% calculado');
  assert.equal(clans.every((c) => typeof c.points === 'number'), true);
});

test('classificação de clãs: ordem estável quando tudo empata', () => {
  const jog = (id, clan) => ({ id, clan_id: clan, display_name: id, points: 0, wins: 0, losses: 0, draws: 0, status: 'active' });
  const players = ['A', 'B'].flatMap((c) => [1, 2, 3, 4].map((k) => jog(`${c}${k}`, c)));
  const ranked = computeStandings(players, [], EVENTO);
  const nomes = () => computeClanStandings(ranked, [{ id: 'B', name: 'Zulu' }, { id: 'A', name: 'Alfa' }]).map((c) => c.name);
  assert.deepEqual(nomes(), ['Alfa', 'Zulu']);
  assert.deepEqual(nomes(), nomes());
});
