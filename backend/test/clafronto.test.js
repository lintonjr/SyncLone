const test = require('node:test');
const assert = require('node:assert/strict');
const { generateClanPairings, seedClanPlayoffPods, clanPairSeats } = require('../src/services/pairing');

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

// Reencontros das tabelas de referência da pasta clafronto, medidos: 4 clãs = 0,
// 5 = 18, 6 = 17, 7 = 20. São modelos feitos à mão, e servem de régua.
const REFERENCIA = { 4: 0, 5: 18, 6: 17, 7: 20 };

// Um torneio de verdade muda a classificação a cada rodada, e era exatamente
// isso que faltava aqui: com os pontos congelados, a ordem dentro do clã nunca
// mudava e a rotação parecia exata mesmo quando não era. Um vencedor por mesa,
// como o evento faz.
function pontuarMesas(pods) {
  for (const pod of pods) {
    const seats = seatsOf(pod);
    seats[Math.floor(Math.random() * seats.length)].points += 3;
  }
}

function reencontrosEm4Rodadas(n) {
  const players = field(n);
  let past = [];
  for (let round = 0; round < 4; round++) {
    const pods = generateClanPairings(players, 'swiss-less-repetition', past, 200, round);
    assertEstrutura(pods, players, `n=${n} r=${round + 1}`);
    past = past.concat(asPast(pods));
    pontuarMesas(pods);
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

test('4 clãs: 4 rodadas sem nenhum reencontro, sempre', () => {
  // Caso exato: a rotação por quadrados latinos garante que cada jogador enfrenta
  // os seus 12 adversários possíveis uma vez cada. Não depende de sorte.
  for (let i = 0; i < 15; i++) {
    assert.equal(reencontrosEm4Rodadas(4), 0, 'a rotação de 4 clãs deve ser exata');
  }
});

test('4 clãs: a rotação não depende da classificação do momento', () => {
  // O que os quadrados latinos organizam é a posição, não a pessoa. Se a ordem
  // dentro do clã mudar entre as rodadas, a garantia some — e some em silêncio,
  // porque cada rodada isolada continua válida. Este teste fixa a rodada e mexe
  // só nos pontos: as mesas têm de sair idênticas.
  const chave = (pods) =>
    pods
      .map((pod) => seatsOf(pod).map((p) => p.id).sort().join('+'))
      .sort()
      .join(' | ');

  for (const round of [0, 1, 2, 3]) {
    const a = field(4);
    const antes = chave(generateClanPairings(a, 'swiss-less-repetition', [], 200, round));

    const b = field(4);
    for (const p of b) p.points = Math.floor(Math.random() * 30);
    const depois = chave(generateClanPairings(b, 'swiss-less-repetition', [], 200, round));

    assert.equal(depois, antes, `rodada ${round + 1} mudou com a classificação`);
  }
});

test('4 clãs: as 4 rodadas cobrem os 12 adversários de cada jogador', () => {
  // A forma forte da mesma garantia: não basta não repetir, a rotação precisa
  // esgotar o cartaz. 16 jogadores, 12 adversários possíveis cada, 96 duplas.
  const players = field(4);
  let past = [];
  for (let round = 0; round < 4; round++) {
    const pods = generateClanPairings(players, 'swiss-less-repetition', past, 200, round);
    past = past.concat(asPast(pods));
    pontuarMesas(pods);
  }

  const duplas = new Set();
  for (const p of past) {
    const seats = [p.player1_id, p.player2_id, p.player3_id, p.player4_id].filter(Boolean).sort();
    for (const [a, b] of pairsIn(seats)) duplas.add(`${a}|${b}`);
  }
  assert.equal(duplas.size, 96, 'as 4 rodadas deveriam produzir 96 duplas distintas');

  for (const jogador of players) {
    const enfrentou = [...duplas].filter((k) => k.split('|').includes(jogador.id)).length;
    assert.equal(enfrentou, 12, `${jogador.id} enfrentou ${enfrentou} adversários, deveria ser 12`);
  }
});

test('5 a 7 clãs: muito abaixo do que as tabelas de referência deixam', () => {
  // Medido em 50 execuções: máximo observado 7, contra 17-20 das tabelas.
  // A régua fica em 9 para o teste não oscilar com o sorteio.
  for (const n of [5, 6, 7]) {
    const r = reencontrosEm4Rodadas(n);
    assert.ok(r <= 9, `${n} clãs: ${r} reencontros, acima do teto de 9`);
    assert.ok(r < REFERENCIA[n], `${n} clãs: ${r} não melhora a tabela (${REFERENCIA[n]})`);
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
  assert.throws(() => generateClanPairings(players, 'swiss', []), /múltiplo de 4|múltiplo de 4/);
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

test('classificação de clãs: conta as mesas do clã, e em 1v1 isso é a soma dos quatro', () => {
  // Os pontos são derivados das mesas, então o cenário precisa ser um torneio
  // possível — não uma tabela inventada. Quatro rodadas de a{i} contra b{i}:
  // Dragões levam as duas primeiras inteiras e vão perdendo espaço depois.
  const jog = (id, clan) => ({ id, clan_id: clan, display_name: id.toUpperCase(), status: 'active' });
  const players = ['a', 'b'].flatMap((c) => [1, 2, 3, 4].map((k) => jog(`${c}${k}`, c === 'a' ? 'A' : 'B')));
  const duelo = (p1, p2, vencedor) => ({
    player1_id: p1, player2_id: p2, player3_id: null, player4_id: null,
    result: vencedor, result_status: 'confirmed', p1_games: null, p2_games: null,
  });
  // 'A' = venceu o do clã A naquela mesa; 'B' = venceu o do clã B.
  const rodadas = [
    ['A', 'A', 'A', 'A'],
    ['A', 'A', 'A', 'A'],
    ['A', 'A', 'B', 'B'],
    ['A', 'B', 'B', 'B'],
  ];
  const pairings = rodadas.flatMap((r) =>
    r.map((quem, i) => duelo(`a${i + 1}`, `b${i + 1}`, quem === 'A' ? 'player1' : 'player2'))
  );


  const ranked = computeStandings(players, pairings, EVENTO);
  const clans = computeClanStandings(ranked, [{ id: 'A', name: 'Dragões' }, { id: 'B', name: 'Corvos' }], pairings, EVENTO);

  // 16 mesas, 16 vitórias no total: 11 dos Dragões (33 pts), 5 dos Corvos (15 pts).
  assert.equal(clans[0].name, 'Dragões');
  assert.equal(clans[0].points, 33);
  assert.equal(clans[0].wins, 11, 'vitórias somadas dos quatro');
  assert.equal(clans[1].name, 'Corvos');
  assert.equal(clans[1].points, 15);
  assert.equal(clans[0].player_count, 4);
  assert.equal(clans[0].points + clans[1].points, 16 * EVENTO.points_win, 'nenhum ponto criado ou perdido');
});

test('classificação de clãs: empate de pontos é decidido pelo desempate agregado', () => {
  // Os dois clãs somam o mesmo; A enfrentou adversários mais fortes.
  const jog = (id, clan) => ({ id, clan_id: clan, display_name: id, wins: 0, losses: 0, draws: 0, status: 'active' });
  const players = [
    jog('a1', 'A'), jog('a2', 'A'), jog('a3', 'A'), jog('a4', 'A'),
    jog('b1', 'B'), jog('b2', 'B'), jog('b3', 'B'), jog('b4', 'B'),
    jog('c1', 'C'), jog('c2', 'C'), jog('c3', 'C'), jog('c4', 'C'),
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
  const clans = computeClanStandings(ranked, [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }], pairings, EVENTO);
  const a = clans.find((c) => c.name === 'A');
  const b = clans.find((c) => c.name === 'B');
  assert.ok(a.omw !== null && b.omw !== null, 'os dois clãs têm OMW% calculado');
  assert.equal(clans.every((c) => typeof c.points === 'number'), true);
});

test('classificação de clãs: ordem estável quando tudo empata', () => {
  const jog = (id, clan) => ({ id, clan_id: clan, display_name: id, wins: 0, losses: 0, draws: 0, status: 'active' });
  const players = ['A', 'B'].flatMap((c) => [1, 2, 3, 4].map((k) => jog(`${c}${k}`, c)));
  const ranked = computeStandings(players, [], EVENTO);
  const nomes = () => computeClanStandings(ranked, [{ id: 'B', name: 'Zulu' }, { id: 'A', name: 'Alfa' }], [], EVENTO).map((c) => c.name);
  assert.deepEqual(nomes(), ['Alfa', 'Zulu']);
  assert.deepEqual(nomes(), nomes());
});

test('clanPairSeats: agrupa os assentos da mesa de duplas por clã', () => {
  // A regra dos parceiros vive aqui e é consumida pela rota de resultado. Os
  // assentos do playoff são alternados (1-3 de um clã, 2-4 do outro), que é como
  // as duplas se sentam de fato à mesa.
  const players = new Map([
    ['a1', { clan_id: 'A' }], ['b1', { clan_id: 'B' }],
    ['a2', { clan_id: 'A' }], ['b2', { clan_id: 'B' }],
  ]);
  const pairing = { player1_id: 'a1', player2_id: 'b1', player3_id: 'a2', player4_id: 'b2' };
  const grupos = clanPairSeats(pairing, players);

  assert.deepEqual([...grupos.keys()].sort(), ['A', 'B']);
  assert.deepEqual(grupos.get('A'), ['a1', 'a2'], 'assentos 1 e 3 são do mesmo clã');
  assert.deepEqual(grupos.get('B'), ['b1', 'b2'], 'assentos 2 e 4 são do mesmo clã');
});

test('clanPairSeats: mesa comum de 4 clãs distintos vira quatro grupos de um', () => {
  const players = new Map([
    ['p1', { clan_id: 'A' }], ['p2', { clan_id: 'B' }],
    ['p3', { clan_id: 'C' }], ['p4', { clan_id: 'D' }],
  ]);
  const pairing = { player1_id: 'p1', player2_id: 'p2', player3_id: 'p3', player4_id: 'p4' };
  const grupos = clanPairSeats(pairing, players);
  assert.equal(grupos.size, 4);
  for (const ids of grupos.values()) assert.equal(ids.length, 1);
});

test('playoff em duplas: os dois parceiros recebem a vitória', () => {
  // Regressão: quando os pontos passaram a ser derivados das mesas, a regra de
  // duplas vivia só na rota que gravava a coluna — e o companheiro do vencedor
  // deixava de pontuar. A mesa de 2 clãs × 2 assentos é a forma que identifica
  // o mata-mata em duplas.
  const jog = (id, clan) => ({ id, clan_id: clan, display_name: id, wins: 0, losses: 0, draws: 0, status: 'active' });
  const players = [jog('a1', 'A'), jog('b1', 'B'), jog('a2', 'A'), jog('b2', 'B')];
  const mesa = {
    player1_id: 'a1', player2_id: 'b1', player3_id: 'a2', player4_id: 'b2',
    result: 'player1', result_status: 'confirmed', p1_games: null, p2_games: null,
  };

  const rows = computeStandings(players, [mesa], EVENTO);
  const por = Object.fromEntries(rows.map((p) => [p.id, p]));

  assert.equal(por.a1.points, 3, 'assento vencedor');
  assert.equal(por.a2.points, 3, 'companheiro de clã ganha junto');
  assert.equal(por.b1.points, 0, 'os dois adversários perdem');
  assert.equal(por.b2.points, 0, 'os dois adversários perdem');
});

test('playoff em duplas: o companheiro não conta como adversário enfrentado', () => {
  const jog = (id, clan) => ({ id, clan_id: clan, display_name: id, wins: 0, losses: 0, draws: 0, status: 'active' });
  const players = [jog('a1', 'A'), jog('b1', 'B'), jog('a2', 'A'), jog('b2', 'B')];
  const mesa = {
    player1_id: 'a1', player2_id: 'b1', player3_id: 'a2', player4_id: 'b2',
    result: 'player1', result_status: 'confirmed', p1_games: null, p2_games: null,
  };
  const rows = computeStandings(players, [mesa], EVENTO);
  const a1 = rows.find((p) => p.id === 'a1');

  // OMW% de a1 é a média dos dois adversários (b1 e b2), ambos no piso de 33%.
  // Se o parceiro a2 entrasse na conta, a média subiria — e o desempate mentiria.
  assert.ok(Math.abs(a1.omw - 1 / 3) < 1e-9, `OMW% de a1: ${a1.omw}`);
});

test('mesa normal de 4 clãs: só o assento vencedor pontua', () => {
  // A contraprova do teste acima: a rodada comum do formato tem quatro clãs
  // distintos, e nela ninguém divide resultado com ninguém.
  const jog = (id, clan) => ({ id, clan_id: clan, display_name: id, wins: 0, losses: 0, draws: 0, status: 'active' });
  const players = [jog('a1', 'A'), jog('b1', 'B'), jog('c1', 'C'), jog('d1', 'D')];
  const mesa = {
    player1_id: 'a1', player2_id: 'b1', player3_id: 'c1', player4_id: 'd1',
    result: 'player1', result_status: 'confirmed', p1_games: null, p2_games: null,
  };
  const rows = computeStandings(players, [mesa], EVENTO);
  const por = Object.fromEntries(rows.map((p) => [p.id, p]));

  assert.equal(por.a1.points, 3);
  assert.equal(por.b1.points + por.c1.points + por.d1.points, 0);
});

test('playoff em duplas: os dois parceiros ganham a vitória no cartel', () => {
  // O cartel segue a mesma regra dos pontos. Quando as duas coisas eram contadas
  // em lugares diferentes, era exatamente aqui que elas divergiam.
  const jog = (id, clan) => ({ id, clan_id: clan, display_name: id, status: 'active' });
  const players = [jog('a1', 'A'), jog('b1', 'B'), jog('a2', 'A'), jog('b2', 'B')];
  const mesa = {
    player1_id: 'a1', player2_id: 'b1', player3_id: 'a2', player4_id: 'b2',
    result: 'player1', result_status: 'confirmed', p1_games: null, p2_games: null,
  };
  const por = Object.fromEntries(computeStandings(players, [mesa], EVENTO).map((p) => [p.id, p]));

  assert.deepEqual([por.a1.wins, por.a1.losses], [1, 0], 'assento vencedor');
  assert.deepEqual([por.a2.wins, por.a2.losses], [1, 0], 'companheiro de clã ganha junto');
  assert.deepEqual([por.b1.wins, por.b1.losses], [0, 1]);
  assert.deepEqual([por.b2.wins, por.b2.losses], [0, 1]);
});
