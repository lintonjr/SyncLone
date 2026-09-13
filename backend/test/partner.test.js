const test = require('node:test');
const assert = require('node:assert');
const { generatePartnerPairings } = require('../src/services/pairing');
const { computeStandings, computeClanStandings } = require('../src/services/standings');

const EVENTO = { points_win: 3, points_draw: 1, points_loss: 0 };

const jog = (id, time) => ({ id, clan_id: time, display_name: id.toUpperCase(), status: 'active' });

/** Quatro duplas: A, B, C e D, cada uma com dois jogadores. */
function campo(nomes = ['A', 'B', 'C', 'D']) {
  const players = nomes.flatMap((t) => [jog(`${t.toLowerCase()}1`, t), jog(`${t.toLowerCase()}2`, t)]);
  const clans = nomes.map((t) => ({ id: t, name: `Dupla ${t}` }));
  return { players, clans };
}

/** As duplas no formato que o pareador espera, a partir de mesas já jogadas. */
function times(players, clans, pairings = []) {
  const ranked = computeStandings(players, pairings, EVENTO);
  return computeClanStandings(ranked, clans, pairings, EVENTO);
}

const mesa = (p1, p2, p3, p4, result) => ({
  round_id: 'r1', player1_id: p1, player2_id: p2, player3_id: p3, player4_id: p4,
  result, result_status: 'confirmed', p1_games: null, p2_games: null,
});

// --- Assentos ---

test('partner: cada mesa tem duas duplas, com os parceiros em 1-3 e 2-4', () => {
  const { players, clans } = campo();
  const pods = generatePartnerPairings(times(players, clans), 'swiss', []);

  assert.equal(pods.length, 2, 'quatro duplas formam duas mesas');
  const porId = new Map(players.map((p) => [p.id, p]));
  for (const pod of pods) {
    const assentos = [pod.player1, pod.player2, pod.player3, pod.player4];
    assert.equal(assentos.filter(Boolean).length, 4);
    // parceiros frente a frente
    assert.equal(porId.get(pod.player1.id).clan_id, porId.get(pod.player3.id).clan_id);
    assert.equal(porId.get(pod.player2.id).clan_id, porId.get(pod.player4.id).clan_id);
    // e os dois lados são duplas diferentes
    assert.notEqual(porId.get(pod.player1.id).clan_id, porId.get(pod.player2.id).clan_id);
  }
});

test('partner: ninguém joga duas mesas na mesma rodada', () => {
  const { players, clans } = campo(['A', 'B', 'C', 'D', 'E', 'F']);
  const pods = generatePartnerPairings(times(players, clans), 'swiss', []);
  const sentados = pods.flatMap((p) => [p.player1, p.player2, p.player3, p.player4]).filter(Boolean);
  assert.equal(sentados.length, 12);
  assert.equal(new Set(sentados.map((p) => p.id)).size, 12);
});

// --- Bye ---

test('partner: número ímpar de duplas gera bye, e a dupla inteira folga', () => {
  const { players, clans } = campo(['A', 'B', 'C']);
  const pods = generatePartnerPairings(times(players, clans), 'swiss', []);

  const byes = pods.filter((p) => !p.player2);
  assert.equal(byes.length, 1, 'três duplas: uma folga');
  // a mesa de bye leva os dois parceiros, nos assentos 1 e 3
  const bye = byes[0];
  assert.ok(bye.player1 && bye.player3, 'os dois integrantes estão na mesa de bye');
  assert.equal(bye.player2, null);
  assert.equal(bye.player4, null);
  const porId = new Map(players.map((p) => [p.id, p]));
  assert.equal(porId.get(bye.player1.id).clan_id, porId.get(bye.player3.id).clan_id);
});

test('partner: o bye não cai duas vezes na mesma dupla enquanto houver quem nunca folgou', () => {
  const { players, clans } = campo(['A', 'B', 'C']);
  const jogadas = [];
  const folgou = [];

  for (let rodada = 0; rodada < 3; rodada++) {
    const pods = generatePartnerPairings(times(players, clans, jogadas), 'swiss', jogadas);
    for (const pod of pods) {
      const linha = mesa(
        pod.player1?.id ?? null, pod.player2?.id ?? null,
        pod.player3?.id ?? null, pod.player4?.id ?? null,
        pod.player2 ? 'player1' : 'bye'
      );
      if (!pod.player2) folgou.push(players.find((p) => p.id === pod.player1.id).clan_id);
      jogadas.push(linha);
    }
  }
  assert.deepEqual([...folgou].sort(), ['A', 'B', 'C'], 'em três rodadas, as três duplas folgaram uma vez cada');
});

// --- Anti-repetição no nível da dupla ---

test('partner: a anti-repetição mede reencontros entre duplas, não entre pessoas', () => {
  const { players, clans } = campo(['A', 'B', 'C', 'D']);
  const jogadas = [];
  const encontros = new Map();

  for (let rodada = 0; rodada < 3; rodada++) {
    const pods = generatePartnerPairings(times(players, clans, jogadas), 'avoid-repetition', jogadas);
    for (const pod of pods) {
      if (!pod.player2) continue;
      const porId = new Map(players.map((p) => [p.id, p]));
      const par = [porId.get(pod.player1.id).clan_id, porId.get(pod.player2.id).clan_id].sort().join('-');
      encontros.set(par, (encontros.get(par) ?? 0) + 1);
      jogadas.push(mesa(pod.player1.id, pod.player2.id, pod.player3.id, pod.player4.id, 'player1'));
    }
  }
  // Quatro duplas rendem três rodadas sem nenhum reencontro.
  assert.equal(encontros.size, 6, 'os seis confrontos possíveis, cada um uma vez');
  assert.equal([...encontros.values()].every((v) => v === 1), true, 'nenhum reencontro em três rodadas');
});

// --- A invariante do formato ---

test('partner: vencer vale 3 para a dupla e 3 para cada parceiro, nunca 6', () => {
  const { players, clans } = campo(['A', 'B']);
  // Dupla A (a1 e a2) vence a dupla B.
  const pairings = [mesa('a1', 'b1', 'a2', 'b2', 'player1')];

  const ranked = computeStandings(players, pairings, EVENTO);
  const porId = new Map(ranked.map((p) => [p.id, p]));
  const times2 = computeClanStandings(ranked, clans, pairings, EVENTO);
  const dupla = times2.find((t) => t.id === 'A');

  assert.equal(porId.get('a1').points, 3, 'o jogador que apareceu no resultado');
  assert.equal(porId.get('a2').points, 3, 'e o parceiro, junto');
  assert.equal(dupla.points, 3, 'a dupla no torneio vale a rodada, não a soma dos dois');
  assert.equal(dupla.wins, 1, 'uma mesa vencida, não duas');

  const perdedora = times2.find((t) => t.id === 'B');
  assert.equal(perdedora.points, 0);
  assert.equal(porId.get('b1').points, 0);
  assert.equal(porId.get('b2').points, 0);
});

test('partner: os pontos de cada parceiro são sempre iguais aos da dupla', () => {
  // A invariante que separa este formato do Clã Fronto, ao longo de um torneio
  // inteiro: como os dois sempre jogam a mesma mesa, o individual e o da dupla
  // são o mesmo número — nunca somados.
  const { players, clans } = campo(['A', 'B', 'C', 'D']);
  const jogadas = [];

  for (let rodada = 0; rodada < 3; rodada++) {
    const pods = generatePartnerPairings(times(players, clans, jogadas), 'swiss', jogadas);
    pods.forEach((pod, i) => {
      if (!pod.player2) { jogadas.push(mesa(pod.player1.id, null, pod.player3.id, null, 'bye')); return; }
      // alterna vencedor e empate, para exercitar os três caminhos de pontuação
      const r = i === 0 ? 'player1' : rodada === 1 ? 'draw' : 'player2';
      jogadas.push(mesa(pod.player1.id, pod.player2.id, pod.player3.id, pod.player4.id, r));
    });
  }

  const ranked = computeStandings(players, jogadas, EVENTO);
  const porId = new Map(ranked.map((p) => [p.id, p]));
  const resultado = computeClanStandings(ranked, clans, jogadas, EVENTO);

  for (const t of resultado) {
    const [p1, p2] = t.players.map((p) => porId.get(p.id));
    assert.equal(p1.points, p2.points, `os dois de ${t.name} têm o mesmo total`);
    assert.equal(t.points, p1.points, `${t.name}: a dupla vale o mesmo que cada parceiro`);
    assert.equal(t.wins, p1.wins, `${t.name}: as vitórias também`);
  }

  // E o total distribuído fecha: cada mesa move pontos uma vez por dupla.
  const mesasComResultado = jogadas.filter((m) => m.result);
  const totalDasDuplas = resultado.reduce((s, t) => s + t.points, 0);
  const esperado = mesasComResultado.reduce((s, m) => {
    if (m.result === 'draw') return s + 2 * EVENTO.points_draw;
    if (m.result === 'bye') return s + EVENTO.points_win;
    return s + EVENTO.points_win + EVENTO.points_loss;
  }, 0);
  assert.equal(totalDasDuplas, esperado, 'nenhum ponto criado ou perdido no nível da dupla');
});

test('partner: dupla incompleta é recusada antes de montar mesa', () => {
  const { players, clans } = campo(['A', 'B']);
  const quebrada = times(players, clans).map((t) =>
    t.id === 'A' ? { ...t, players: t.players.slice(0, 1) } : t
  );
  assert.throws(() => generatePartnerPairings(quebrada, 'swiss', []), /não tem dois jogadores/);
});

test('partner: no bye, os dois parceiros contam o 2-0 para o GW%', () => {
  const { players, clans } = campo(['A']);
  const jogadas = [mesa('a1', null, 'a2', null, 'bye')];
  const ranked = computeStandings(players, jogadas, EVENTO);
  const porId = new Map(ranked.map((p) => [p.id, p]));
  assert.equal(porId.get('a1').gwp, 1, 'quem ocupa o primeiro assento');
  assert.equal(porId.get('a2').gwp, 1, 'e o parceiro, que folgou junto');
  assert.equal(porId.get('a1').points, porId.get('a2').points);
});

// --- Desempate por ponto flutuante ---

const { cmpPct } = require('../src/lib/percentuais');

test('desempate: diferença no último bit não desempata', () => {
  // Foi assim que o chaveamento de 8 duplas discordou da tabela: duas equipes
  // com o mesmo OMW% matemático saíam com bits diferentes, e o sort decidia ali
  // em vez de passar ao critério seguinte.
  const a = 0.6333333333333334;
  const b = 0.6333333333333333;
  assert.notEqual(a, b, 'os dois floats são de fato diferentes');
  assert.equal(cmpPct(a, b), 0, 'mas para o desempate são o mesmo número');
  assert.equal(cmpPct(b, a), 0);

  // e uma diferença real continua desempatando, na direção certa
  assert.ok(cmpPct(0.7, 0.6) < 0, 'quem tem mais vem antes');
  assert.ok(cmpPct(0.6, 0.7) > 0);
});

test('desempate: empate no percentual cai para o critério seguinte', () => {
  const players = [
    { id: 'a', display_name: 'Zulu', clan_id: 'A', status: 'active' },
    { id: 'b', display_name: 'Alfa', clan_id: 'B', status: 'active' },
  ];
  const ranked = computeStandings(players, [], EVENTO);
  // sem nenhuma mesa, os dois empatam em tudo: decide o nome, e a ordem é estável
  assert.deepEqual(ranked.map((p) => p.display_name), ['Alfa', 'Zulu']);
  const denovo = computeStandings(players, [], EVENTO);
  assert.deepEqual(ranked.map((p) => p.id), denovo.map((p) => p.id));
});
