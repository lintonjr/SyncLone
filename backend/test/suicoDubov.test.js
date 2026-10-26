/**
 * Suíço por desempenho em duelo (FIDE C.04.1 + Dubov C.04.4.1).
 *
 * O teste que importa é o último: um gerador de torneios que roda o pareamento
 * de verdade e compara o número de revanches com o MÍNIMO POSSÍVEL, calculado
 * por uma referência independente (DP exata sobre bitmask escrita aqui, que só
 * minimiza revanche e não conhece os outros critérios). Sem essa referência, um
 * teste de "zero revanches" só afirmaria que o algoritmo concorda consigo mesmo
 * — e o caminho antigo passaria em qualquer asserção frouxa, porque em campo
 * cheio ele acerta a maioria das mesas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateSwissPairings } = require('../src/services/pairing');
const { parearDubov1v1, fechaSemRevanche } = require('../src/services/suicoDubov');
const { computeStandings } = require('../src/services/standings');

const EVENTO = { points_win: 3, points_draw: 1, points_loss: 0 };

const seats = (pod) => [pod.player1, pod.player2, pod.player3, pod.player4].filter(Boolean);
const isBye = (pod) => !pod.player2;
const chave = (a, b) => [a, b].sort().join('|');

const histDe = (mesas) => {
  const h = new Map();
  for (const m of mesas) {
    const ids = [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter(Boolean);
    for (const a of ids) {
      if (!h.has(a)) h.set(a, new Set());
      for (const b of ids) if (b !== a) h.get(a).add(b);
    }
  }
  return h;
};

const duelo = (a, b) => ({ player1_id: a, player2_id: b, player3_id: null, player4_id: null, result: 'player1', result_status: 'confirmed' });

// --- RNG com semente: o pareamento usa Math.random, e um teste que depende de
// sorteio precisa ser reproduzível quando falha. ---
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function comSemente(semente, fn) {
  const original = Math.random;
  Math.random = mulberry32(semente);
  try { return fn(); } finally { Math.random = original; }
}

/**
 * REFERÊNCIA INDEPENDENTE: o mínimo de revanches de um campo par, exato.
 * Só conta revanche — não sabe de pontos, adjacência nem flutuação.
 */
function minimoDeRevanches(ids, historico) {
  const n = ids.length;
  if (n === 0) return 0;
  if (n % 2 !== 0) throw new Error('campo ímpar');
  const memo = new Map();
  const resolver = (mascara) => {
    if (mascara === (1 << n) - 1) return 0;
    if (memo.has(mascara)) return memo.get(mascara);
    let i = 0;
    while (mascara & (1 << i)) i++;
    let melhor = Infinity;
    for (let j = i + 1; j < n; j++) {
      if (mascara & (1 << j)) continue;
      const custo = historico.get(ids[i])?.has(ids[j]) ? 1 : 0;
      melhor = Math.min(melhor, custo + resolver(mascara | (1 << i) | (1 << j)));
    }
    memo.set(mascara, melhor);
    return melhor;
  };
  return resolver(0);
}

// ---------------------------------------------------------------------------
// Os critérios, um a um
// ---------------------------------------------------------------------------

test('[C1] revanche é absoluta: vence a adjacência e vence o Δ de pontos', () => {
  // 1º e 2º já se enfrentaram. A adjacência quer p1×p2 e p3×p4; o critério
  // absoluto tem de desmanchar isso.
  const campo = [
    { id: 'p1', points: 6 }, { id: 'p2', points: 6 },
    { id: 'p3', points: 3 }, { id: 'p4', points: 3 },
  ];
  const { mesas, revanches } = parearDubov1v1(campo, histDe([duelo('p1', 'p2')]));
  assert.equal(revanches, 0);
  const pares = mesas.map(([a, b]) => chave(a.id, b.id)).sort();
  assert.deepEqual(pares, [chave('p1', 'p3'), chave('p2', 'p4')].sort());
});

test('adjacência Dubov: dentro do mesmo grupo de pontos, 1º×2º e 3º×4º', () => {
  const campo = [
    { id: 'p1', points: 3 }, { id: 'p2', points: 3 },
    { id: 'p3', points: 3 }, { id: 'p4', points: 3 },
  ];
  const { mesas } = parearDubov1v1(campo, new Map());
  const pares = mesas.map(([a, b]) => chave(a.id, b.id)).sort();
  assert.deepEqual(pares, [chave('p1', 'p2'), chave('p3', 'p4')].sort());
});

test('[C5] grupo de pontos par não se mistura com outro', () => {
  // Dois grupos de 2. Existe pareamento com zero deslocamento (a1×a2, b1×b2) e
  // vários com dois; o Δ² obriga o primeiro (0 contra 162).
  const campo = [
    { id: 'a1', points: 9 }, { id: 'a2', points: 9 },
    { id: 'b1', points: 0 }, { id: 'b2', points: 0 },
  ];
  const { mesas } = parearDubov1v1(campo, new Map());
  for (const [a, b] of mesas) assert.equal(a.points, b.points, 'ninguém devia flutuar');
});

test('[C6] deslocamento espalhado, não concentrado: 9x6 e 6x3, nunca 9x3', () => {
  // Grupos de 9 (um), 6 (dois) e 3 (um): alguém tem de jogar fora do grupo.
  // Duas saídas somam o mesmo Δ total (6): diferenças [3,3] ou [6,0]. Dubov
  // 2.3.2 compara em ordem descendente, então [3,3] é a certa — e [6,0] é
  // literalmente uma mesa de 3-1 contra 1-3, a mesa estranha que motivou este
  // trabalho. Este teste é o que pegou o critério errado da primeira versão.
  const campo = [
    { id: 'x', points: 9 },
    { id: 'm1', points: 6 }, { id: 'm2', points: 6 },
    { id: 'z', points: 3 },
  ];
  const { mesas } = parearDubov1v1(campo, new Map());
  const deltas = mesas.map(([a, b]) => Math.abs(a.points - b.points)).sort((p, q) => q - p);
  assert.deepEqual(deltas, [3, 3], `concentrou o deslocamento: Δ ${deltas.join(',')}`);
});

test('relaxamento: campo sem saída recebe o MÍNIMO de revanches, não "tanto faz"', () => {
  // Quatro jogadores que já se enfrentaram quase todos. Qualquer pareamento
  // repete ao menos uma mesa; não pode repetir duas, e não pode estourar.
  const campo = [
    { id: 'p1', points: 3 }, { id: 'p2', points: 3 },
    { id: 'p3', points: 3 }, { id: 'p4', points: 3 },
  ];
  // p1 já enfrentou todo mundo, e p3xp4 também aconteceu. Das três formas de
  // montar duas mesas, nenhuma escapa de repetir: duas repetem uma mesa e uma
  // repete duas. O mínimo é 1.
  const historico = histDe([duelo('p1', 'p2'), duelo('p1', 'p3'), duelo('p1', 'p4'), duelo('p3', 'p4')]);
  const { mesas, revanches } = parearDubov1v1(campo, historico);
  assert.equal(mesas.length, 2);
  const minimo = minimoDeRevanches(campo.map((p) => p.id), historico);
  assert.equal(revanches, minimo, 'devia empatar com o mínimo exato');
  assert.equal(minimo, 1, 'o campo deste teste tem exatamente uma saída de custo 1');
});

test('fechaSemRevanche responde o critério de completude [C4]', () => {
  const campo = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }];
  assert.equal(fechaSemRevanche(campo, histDe([duelo('p1', 'p2')])), true);
  assert.equal(
    fechaSemRevanche(campo, histDe([duelo('p1', 'p2'), duelo('p3', 'p4'), duelo('p1', 'p3'), duelo('p2', 'p4'), duelo('p1', 'p4'), duelo('p2', 'p3')])),
    false,
    'todos contra todos já aconteceu: não fecha'
  );
});

// ---------------------------------------------------------------------------
// O bye, pela ordem do Dubov 3.1
// ---------------------------------------------------------------------------

test('bye 3.1.2: não escolhe quem deixaria o resto sem pareamento possível', () => {
  // Gabi é a última colocada, então 3.1.3 a escolheria. Mas p1 já enfrentou
  // p2, p3 e p4: tirando Gabi, as três formas de montar as duas mesas restantes
  // caem todas numa revanche de p1. Tirando p4, sobra (p1 x Gabi) + (p2 x p3),
  // que fecha limpo — e é esse o candidato que 3.1.2 manda escolher.
  const campo = [
    { id: 'p1', points: 9 }, { id: 'p2', points: 3 },
    { id: 'p3', points: 3 }, { id: 'p4', points: 3 },
    { id: 'gabi', points: 0 },
  ];
  const past = [duelo('p1', 'p2'), duelo('p1', 'p3'), duelo('p1', 'p4')];
  const pods = generateSwissPairings(campo, 2, 'swiss', past);
  const bye = pods.filter(isBye);
  assert.equal(bye.length, 1);
  assert.notEqual(bye[0].player1.id, 'gabi', '3.1.2 foi ignorado');
  const historico = histDe(past);
  const repetidas = pods.filter((p) => !isBye(p) && historico.get(p.player1.id)?.has(p.player2.id));
  assert.equal(repetidas.length, 0, 'com o bye certo, a rodada fecha sem revanche');
});

test('bye 3.1.4: empatados em pontos, o bye vai para quem jogou MAIS partidas', () => {
  // Os dois têm 0 ponto. "tarde" entrou na 3ª rodada e já ficou de fora duas
  // vezes; "sempre" jogou tudo. O bye é de quem jogou mais.
  const campo = [
    { id: 'lider', points: 6, matches_played: 2 },
    { id: 'meio', points: 3, matches_played: 2 },
    { id: 'sempre', points: 0, matches_played: 2 },
    { id: 'tarde', points: 0, matches_played: 0 },
    { id: 'outro', points: 3, matches_played: 2 },
  ];
  for (let i = 0; i < 40; i++) {
    const bye = generateSwissPairings(campo, 2, 'swiss', []).filter(isBye);
    assert.equal(bye[0].player1.id, 'sempre', '3.1.4 foi ignorado');
  }
});

test('swiss-less-repetition em duelo aponta para o mesmo Dubov', () => {
  const campo = [
    { id: 'p1', points: 6 }, { id: 'p2', points: 6 },
    { id: 'p3', points: 3 }, { id: 'p4', points: 3 },
  ];
  const pods = generateSwissPairings(campo, 2, 'swiss-less-repetition', [duelo('p1', 'p2')]);
  const historico = histDe([duelo('p1', 'p2')]);
  const repetidas = pods.filter((p) => !isBye(p) && historico.get(p.player1.id)?.has(p.player2.id));
  assert.equal(repetidas.length, 0);
});

// ---------------------------------------------------------------------------
// O torneio completo
// ---------------------------------------------------------------------------

/**
 * Roda um torneio de verdade: classificação pelo `computeStandings`, pareamento
 * pelo `generateSwissPairings`, resultados por força oculta. É o mesmo encadeado
 * de `routes/events.js` ao iniciar uma rodada.
 */
function torneio({ jogadores, rodadas, metodo = 'swiss', semente, empate = 0, drop = 0 }) {
  return comSemente(semente, () => {
    const rnd = Math.random;
    const todos = Array.from({ length: jogadores }, (_, i) => ({
      id: `p${String(i + 1).padStart(2, '0')}`,
      display_name: `J${String(i + 1).padStart(2, '0')}`,
      status: 'active',
      forca: 1600 - i * 25,
    }));
    const forca = new Map(todos.map((p) => [p.id, p.forca]));
    const past = [];
    const observado = [];

    for (let r = 1; r <= rodadas; r++) {
      if (drop > 0 && r > 1) {
        for (const s of computeStandings(todos, past, EVENTO)) {
          const p = todos.find((x) => x.id === s.id);
          if (p.status === 'active' && rnd() < drop * (s.losses >= 2 ? 2.5 : 1)) p.status = 'dropped';
        }
      }
      const classificacao = computeStandings(todos, past, EVENTO);
      const ativos = classificacao.filter((p) => p.status === 'active');
      if (ativos.length < 2) break;

      const historico = histDe(past);
      const pods = generateSwissPairings(ativos, 2, metodo, past);

      // Invariantes de forma: ninguém sentado duas vezes, ninguém de fora.
      const sentados = pods.flatMap(seats).map((p) => p.id);
      assert.equal(sentados.length, ativos.length, `R${r}: assentos != ativos`);
      assert.equal(new Set(sentados).size, sentados.length, `R${r}: alguém sentou duas vezes`);

      const mesas1v1 = pods.filter((p) => !isBye(p));
      const idsPareados = new Set(mesas1v1.flatMap((p) => [p.player1.id, p.player2.id]));
      // O caminho antigo, reconstruído sobre EXATAMENTE o mesmo campo: a ordem
      // da classificação fatiada em pares adjacentes. É com isso que o Δ e as
      // revanches do Dubov se comparam — mesma entrada, duas estratégias.
      const naOrdem = ativos.filter((p) => idsPareados.has(p.id));
      let gapAdjacente = 0;
      let revanchesAdjacente = 0;
      for (let i = 0; i + 1 < naOrdem.length; i += 2) {
        gapAdjacente += Math.abs(naOrdem[i].points - naOrdem[i + 1].points);
        if (historico.get(naOrdem[i].id)?.has(naOrdem[i + 1].id)) revanchesAdjacente++;
      }
      observado.push({
        rodada: r,
        campo: mesas1v1.flatMap((p) => [p.player1.id, p.player2.id]),
        revanches: mesas1v1.filter((p) => historico.get(p.player1.id)?.has(p.player2.id)).length,
        historico,
        gap: mesas1v1.reduce((s, p) => s + Math.abs(p.player1.points - p.player2.points), 0),
        gapAdjacente,
        revanchesAdjacente,
      });

      const linhas = pods.map((pod, i) => ({
        round_id: `r${r}`, is_playoff: 0, table_number: i + 1,
        player1_id: pod.player1?.id ?? null, player2_id: pod.player2?.id ?? null,
        player3_id: null, player4_id: null,
        result: pod.player2 ? null : 'bye', result_status: 'confirmed',
        p1_games: null, p2_games: null,
      }));
      for (const linha of linhas) {
        if (!linha.player2_id) continue;
        if (rnd() < empate) { linha.result = 'draw'; continue; }
        const pa = 1 / (1 + 10 ** ((forca.get(linha.player2_id) - forca.get(linha.player1_id)) / 400));
        linha.result = rnd() < pa ? 'player1' : 'player2';
      }
      past.push(...linhas);
    }
    return { observado, past };
  });
}

test('17 jogadores, 5 rodadas (Appendix E do MTR): zero revanches', () => {
  // A mesma semente que, no fatiamento adjacente, produzia 4 reencontros —
  // inclusive líder invicto reencontrando quem já tinha derrotado, na mesa 1 da
  // rodada 5.
  const { observado } = torneio({ jogadores: 17, rodadas: 5, semente: 42 });
  assert.equal(observado.length, 5);
  const total = observado.reduce((s, o) => s + o.revanches, 0);
  assert.equal(total, 0, `revanches por rodada: ${observado.map((o) => o.revanches).join(',')}`);
});

test('nenhum par se encontra duas vezes em todo o torneio (17/5)', () => {
  for (const semente of [1, 2, 3, 7, 42, 99, 312, 777]) {
    const { past } = torneio({ jogadores: 17, rodadas: 5, semente });
    const vistos = new Map();
    for (const m of past) {
      if (!m.player2_id) continue;
      const k = chave(m.player1_id, m.player2_id);
      vistos.set(k, (vistos.get(k) ?? 0) + 1);
    }
    const repetidos = [...vistos.entries()].filter(([, n]) => n > 1);
    assert.deepEqual(repetidos, [], `semente ${semente}: ${JSON.stringify(repetidos)}`);
  }
});

test('bye: ninguém recebe dois enquanto houver quem nunca recebeu (17/5)', () => {
  for (const semente of [5, 11, 23, 64]) {
    const { past } = torneio({ jogadores: 17, rodadas: 5, semente });
    const contagem = new Map();
    for (const m of past) {
      if (m.result === 'bye') contagem.set(m.player1_id, (contagem.get(m.player1_id) ?? 0) + 1);
    }
    assert.equal([...contagem.values()].filter((n) => n > 1).length, 0, `semente ${semente}`);
  }
});

test('PORTÃO: as revanches igualam o mínimo exato, em campo variado', () => {
  // Varre tamanho, nº de rodadas, empates e drops. O campo pareado fica em 18
  // ou menos para a referência exata caber — é também a faixa em que o módulo
  // usa a conta exata, então o que se mede aqui é o algoritmo, não a heurística.
  let rodadasVerificadas = 0;
  let piorFolga = 0;

  for (const jogadores of [8, 11, 14, 17, 19]) {
    for (const rodadas of [3, 5, 7]) {
      for (const [empate, drop] of [[0, 0], [0.1, 0], [0.1, 0.08]]) {
        for (const semente of [1, 2, 3, 4, 5]) {
          const { observado } = torneio({ jogadores, rodadas, semente, empate, drop });
          for (const o of observado) {
            if (o.campo.length === 0 || o.campo.length > 18) continue;
            const minimo = minimoDeRevanches(o.campo, o.historico);
            assert.equal(
              o.revanches, minimo,
              `${jogadores}j/${rodadas}r e=${empate} d=${drop} semente ${semente} R${o.rodada}: ` +
              `${o.revanches} revanches, mínimo ${minimo}`
            );
            piorFolga = Math.max(piorFolga, o.revanches - minimo);
            rodadasVerificadas++;
          }
        }
      }
    }
  }

  assert.ok(rodadasVerificadas > 500, `amostra pequena: ${rodadasVerificadas}`);
  assert.equal(piorFolga, 0);
});

test('zerar revanche não custa Δ: comparado com o fatiamento adjacente', () => {
  // A medição que justificou a troca. Para cada rodada, o fatiamento adjacente
  // é recalculado sobre o mesmo campo, e se comparam as duas contas. O esperado:
  // o Dubov tem MENOS revanche e o Δ não piora.
  let gapDubov = 0;
  let gapAdjacente = 0;
  let revDubov = 0;
  let revAdjacente = 0;

  for (const semente of [1, 2, 3, 4, 5, 6, 7, 8, 42, 99]) {
    for (const o of torneio({ jogadores: 17, rodadas: 5, semente }).observado) {
      gapDubov += o.gap;
      gapAdjacente += o.gapAdjacente;
      revDubov += o.revanches;
      revAdjacente += o.revanchesAdjacente;
    }
  }

  assert.equal(revDubov, 0, 'o Dubov não devia repetir mesa nenhuma');
  assert.ok(revAdjacente > 0,
    'o fatiamento adjacente devia repetir — se não repetiu, a comparação não prova nada');
  assert.ok(gapDubov <= gapAdjacente,
    `o Δ piorou: Dubov ${gapDubov} contra ${gapAdjacente} do fatiamento adjacente`);
});

test('campo grande cai na heurística sem revanche e sem estourar o tempo', () => {
  // Acima de 20 o módulo troca a conta exata por guloso + 2-opt. Aqui o que se
  // exige é o resultado prático: rodada montada, ninguém repetido, e rápido.
  const inicio = Date.now();
  const { observado } = torneio({ jogadores: 64, rodadas: 6, semente: 17 });
  const total = observado.reduce((s, o) => s + o.revanches, 0);
  assert.equal(total, 0, `revanches: ${observado.map((o) => o.revanches).join(',')}`);
  assert.ok(Date.now() - inicio < 15000, 'pareamento de 64 jogadores ficou lento');
});
