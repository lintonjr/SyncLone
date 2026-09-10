const test = require('node:test');
const assert = require('node:assert/strict');
const { generateSwissPairings, seedPlayoffPods } = require('../src/services/pairing');

// Players ordered best-first; points descend so Swiss ordering is predictable.
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, points: n - i }));

const seatsOf = (pod) => [pod.player1, pod.player2, pod.player3, pod.player4].filter(Boolean);
const allSeats = (pods) => pods.flatMap(seatsOf);
const isBye = (pod) => !pod.player2;

// Everyone is seated exactly once, every round, whatever the method.
function assertSeatsEveryoneOnce(pods, expected) {
  const ids = allSeats(pods).map((p) => p.id);
  assert.equal(ids.length, expected.length, 'seat count');
  assert.deepEqual([...ids].sort(), [...expected].map((p) => p.id).sort());
}

test('swiss: pairs an even 1v1 field with no byes', () => {
  const field = players(4);
  const pods = generateSwissPairings(field, 2, 'swiss');
  assert.equal(pods.length, 2);
  assert.equal(pods.some(isBye), false);
  assertSeatsEveryoneOnce(pods, field);
});

test('swiss: the odd player out gets the bye, and it is the lowest standing', () => {
  const field = players(5);
  const pods = generateSwissPairings(field, 2, 'swiss');
  const byes = pods.filter(isBye);
  assert.equal(byes.length, 1);
  assert.equal(byes[0].player1.id, 'p5');
  assertSeatsEveryoneOnce(pods, field);
});

test('swiss: pairs by standing — top seed meets the next seed', () => {
  const field = players(4);
  const pods = generateSwissPairings(field, 2, 'swiss');
  const top = pods.find((p) => seatsOf(p).some((s) => s.id === 'p1'));
  assert.deepEqual(seatsOf(top).map((s) => s.id), ['p1', 'p2']);
});

// Pod remainders are the fiddly part of multiplayer formats: 1 or 2 left over
// become individual byes, 3 left over play a short pod together.
test('pods of 4: a remainder of 1 becomes a single bye', () => {
  const field = players(9);
  const pods = generateSwissPairings(field, 4, 'swiss');
  assert.equal(pods.filter((p) => seatsOf(p).length === 4).length, 2);
  assert.equal(pods.filter(isBye).length, 1);
  assertSeatsEveryoneOnce(pods, field);
});

test('pods of 4: a remainder of 2 becomes two separate byes, not a duel', () => {
  const field = players(10);
  const pods = generateSwissPairings(field, 4, 'swiss');
  assert.equal(pods.filter(isBye).length, 2);
  assertSeatsEveryoneOnce(pods, field);
});

test('pods of 4: a remainder of 3 plays a short pod instead of taking byes', () => {
  const field = players(11);
  const pods = generateSwissPairings(field, 4, 'swiss');
  assert.equal(pods.filter(isBye).length, 0);
  assert.equal(pods.filter((p) => seatsOf(p).length === 3).length, 1);
  assertSeatsEveryoneOnce(pods, field);
});

test('random: seats everyone exactly once', () => {
  const field = players(7);
  const pods = generateSwissPairings(field, 2, 'random');
  assertSeatsEveryoneOnce(pods, field);
});

test('avoid-repetition: does not re-pair opponents when another pairing exists', () => {
  const field = players(4);
  // Round 1 was p1-p2 and p3-p4; a rematch is avoidable, so none should happen.
  const past = [
    { player1_id: 'p1', player2_id: 'p2', player3_id: null, player4_id: null },
    { player1_id: 'p3', player2_id: 'p4', player3_id: null, player4_id: null },
  ];
  for (const method of ['avoid-repetition', 'swiss-less-repetition']) {
    const pods = generateSwissPairings(field, 2, method, past);
    const rematch = pods.some((pod) => {
      const ids = seatsOf(pod).map((s) => s.id).sort().join('-');
      return ids === 'p1-p2' || ids === 'p3-p4';
    });
    assert.equal(rematch, false, `${method} produced a rematch`);
    assertSeatsEveryoneOnce(pods, field);
  }
});

test('avoid-repetition: counts every podmate as a played opponent, not just 1v1', () => {
  const field = players(8);
  // p1-p4 shared a pod last round. Pairing 1v1 now, each of them has four
  // untouched opponents available, so none of the four should meet again.
  const past = [{ player1_id: 'p1', player2_id: 'p2', player3_id: 'p3', player4_id: 'p4' }];
  const pods = generateSwissPairings(field, 2, 'avoid-repetition', past);
  const repeated = pods.some(
    (pod) => seatsOf(pod).filter((s) => ['p1', 'p2', 'p3', 'p4'].includes(s.id)).length > 1
  );
  assert.equal(repeated, false);
  assertSeatsEveryoneOnce(pods, field);
});

test('playoff seeding 1v1: best seed meets worst', () => {
  const pods = seedPlayoffPods(players(8), 2);
  assert.deepEqual(
    pods.map((p) => seatsOf(p).map((s) => s.id)),
    [['p1', 'p8'], ['p2', 'p7'], ['p3', 'p6'], ['p4', 'p5']]
  );
});

test('playoff seeding 1v1: an odd bracket gives the middle seed a bye', () => {
  const pods = seedPlayoffPods(players(5), 2);
  const byes = pods.filter(isBye);
  assert.equal(byes.length, 1);
  assert.equal(byes[0].player1.id, 'p3');
});

test('playoff seeding in pods: top seeds are spread across pods, not stacked', () => {
  const pods = seedPlayoffPods(players(8), 4);
  assert.equal(pods.length, 2);
  const podWithTop = pods.find((p) => seatsOf(p).some((s) => s.id === 'p1'));
  assert.equal(seatsOf(podWithTop).some((s) => s.id === 'p2'), false, 'seeds 1 and 2 landed together');
  assertSeatsEveryoneOnce(pods, players(8));
});

// --- Fairness do bye entre rodadas ---

// Um pareamento de bye tem só o assento 1 ocupado.
const byePairing = (id) => ({ player1_id: id, player2_id: null, player3_id: null, player4_id: null, result: 'bye' });

test('bye: não repete no mesmo jogador enquanto houver quem nunca recebeu', () => {
  const field = players(5);
  // p5 (último colocado) levou o bye na rodada 1; agora deve ser a vez de outro.
  const past = [
    byePairing('p5'),
    { player1_id: 'p1', player2_id: 'p2', player3_id: null, player4_id: null, result: 'player1' },
    { player1_id: 'p3', player2_id: 'p4', player3_id: null, player4_id: null, result: 'player1' },
  ];
  const pods = generateSwissPairings(field, 2, 'swiss', past);
  const byes = pods.filter(isBye);
  assert.equal(byes.length, 1);
  assert.notEqual(byes[0].player1.id, 'p5');
  assertSeatsEveryoneOnce(pods, field);
});

test('bye: escolhe o pior colocado entre os elegíveis', () => {
  const field = players(5);
  const past = [byePairing('p5')];
  const pods = generateSwissPairings(field, 2, 'swiss', past);
  // p5 está fora da fila; o próximo de baixo para cima é p4.
  assert.equal(pods.filter(isBye)[0].player1.id, 'p4');
});

test('bye: com todo mundo já servido, volta a distribuir sem quebrar', () => {
  const field = players(3);
  const past = [byePairing('p1'), byePairing('p2'), byePairing('p3')];
  const pods = generateSwissPairings(field, 2, 'swiss', past);
  assert.equal(pods.filter(isBye).length, 1);
  assertSeatsEveryoneOnce(pods, field);
});

test('bye: em pods de 4 com resto 2, os dois byes vão para quem ainda não teve', () => {
  const field = players(6);
  const past = [byePairing('p5'), byePairing('p6')];
  const pods = generateSwissPairings(field, 4, 'swiss', past);
  const byeIds = pods.filter(isBye).map((p) => p.player1.id);
  assert.equal(byeIds.length, 2);
  assert.equal(byeIds.includes('p5'), false);
  assert.equal(byeIds.includes('p6'), false);
  assertSeatsEveryoneOnce(pods, field);
});

test('bye: a fairness vale também para os métodos anti-repetição', () => {
  const field = players(5);
  const past = [byePairing('p5')];
  for (const method of ['avoid-repetition', 'swiss-less-repetition', 'random']) {
    const pods = generateSwissPairings(field, 2, method, past);
    const byes = pods.filter(isBye);
    assert.equal(byes.length, 1, method);
    assert.notEqual(byes[0].player1.id, 'p5', `${method} repetiu o bye`);
    assertSeatsEveryoneOnce(pods, field);
  }
});

// --- O bye segue a classificação, não o método de pareamento ---

// Campo ímpar (gera exatamente 1 bye) com lanterna isolada: Gabi é o único com 0.
const fieldWithTail = () => [
  { id: 'ana', points: 9 }, { id: 'bruno', points: 6 }, { id: 'carla', points: 6 },
  { id: 'diego', points: 3 }, { id: 'elisa', points: 3 }, { id: 'heitor', points: 3 },
  { id: 'gabi', points: 0 },
];

test('bye: vai para o pior colocado em TODOS os métodos de pareamento', () => {
  // O bye vale uma vitória inteira; nenhum método pode entregá-lo ao líder.
  for (const method of ['swiss', 'swiss-less-repetition', 'avoid-repetition', 'random']) {
    for (let i = 0; i < 60; i++) {
      const pods = generateSwissPairings(fieldWithTail(), 2, method, []);
      const bye = pods.filter(isBye);
      assert.equal(bye.length, 1, method);
      assert.equal(bye[0].player1.id, 'gabi', `${method} deu bye a quem não era o último`);
    }
  }
});

test('bye: usa os desempates oficiais quando os pontos empatam', () => {
  // Diego e Elisa empatam em 3 pontos; Elisa tem OMW% pior, então é a última.
  const field = [
    { id: 'ana', points: 9, omw: 0.5, gwp: 0.7, ogw: 0.5 },
    { id: 'bruno', points: 6, omw: 0.5, gwp: 0.6, ogw: 0.5 },
    { id: 'diego', points: 3, omw: 0.60, gwp: 0.5, ogw: 0.5 },
    { id: 'elisa', points: 3, omw: 0.40, gwp: 0.5, ogw: 0.5 },
  ];
  for (const method of ['swiss', 'random']) {
    for (let i = 0; i < 40; i++) {
      const bye = generateSwissPairings(field, 2, method, []).filter(isBye);
      assert.equal(bye.length, 0, 'campo par não gera bye');
    }
  }
  const impar = [...field, { id: 'gabi', points: 3, omw: 0.20, gwp: 0.5, ogw: 0.5 }];
  for (let i = 0; i < 40; i++) {
    const bye = generateSwissPairings(impar, 2, 'swiss', []).filter(isBye);
    assert.equal(bye[0].player1.id, 'gabi', 'menor OMW% entre os empatados deve levar o bye');
  }
});

test('bye: empate exato é sorteio justo, não a ordem de chegada da lista', () => {
  // Rodada 1: ninguém pontuou, então todos empatam e o sorteio decide.
  const field = players(7).map((p) => ({ ...p, points: 0 }));
  const contagem = new Map();
  const RODADAS = 3500;
  for (let i = 0; i < RODADAS; i++) {
    const id = generateSwissPairings(field, 2, 'swiss', []).find(isBye).player1.id;
    contagem.set(id, (contagem.get(id) ?? 0) + 1);
  }
  assert.equal(contagem.size, 7, 'todos precisam ser sorteáveis');

  // Uniforme: cada um perto de 1/7. Uma margem generosa ainda reprova o viés
  // do comparador aleatório antigo, que concentrava 27% num e 4% noutro.
  const esperado = RODADAS / 7;
  for (const [id, n] of contagem) {
    const desvio = Math.abs(n - esperado) / esperado;
    assert.ok(desvio < 0.25, `${id} saiu ${(n / RODADAS * 100).toFixed(1)}% — distribuição enviesada`);
  }
});

test('bye: o sorteio é refeito a cada pareamento', () => {
  // Convenção escolhida: repareamento (depois de um Undo, por exemplo) pode
  // trocar quem senta fora enquanto o empate persistir.
  const field = players(7).map((p) => ({ ...p, points: 0 }));
  const vistos = new Set();
  for (let i = 0; i < 200; i++) {
    vistos.add(generateSwissPairings(field, 2, 'swiss', []).find(isBye).player1.id);
  }
  assert.ok(vistos.size > 1, 'o mesmo jogador saiu em 200 pareamentos seguidos');
});

test('bye: classificação decide, mas o histórico continua tendo prioridade', () => {
  // Gabi é o último colocado, mas já recebeu bye: a vez passa para o próximo de baixo.
  const past = [byePairing('gabi')];
  for (let i = 0; i < 60; i++) {
    const bye = generateSwissPairings(fieldWithTail(), 2, 'avoid-repetition', past).filter(isBye);
    assert.equal(bye.length, 1);
    assert.notEqual(bye[0].player1.id, 'gabi');
    assert.ok(['diego', 'elisa', 'heitor'].includes(bye[0].player1.id),
      `esperado um dos empatados em 3 pontos, veio ${bye[0].player1.id}`);
  }
});
