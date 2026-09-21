const { cmpPct } = require('../lib/percentuais');

const asPod = (g) => ({
  player1: g[0] ?? null,
  player2: g[1] ?? null,
  player3: g[2] ?? null,
  player4: g[3] ?? null,
});

/**
 * Chunk an already-ordered player list into full pods of `podSize`, then
 * handle whatever's left over:
 *
 * podSize >= 3 (Commander/multiplayer):
 *   - Remainder 1 : 1 BYE (auto-win, no opponent).
 *   - Remainder 2 : 2 separate BYEs (each player auto-wins).
 *   - Remainder 3 : 1 smaller pod of 3.
 *
 * podSize = 2 (1v1):
 *   - A single leftover player gets a BYE.
 *
 * `generateSwissPairings` normally hands this list with the bye players already
 * removed (see `pickByePlayers`), so the leftover branches only fire for the
 * remainder-3 short pod. They're kept for the greedy leftover and for safety.
 */
function chunkIntoPods(orderedPlayers, podSize) {
  const groups = [];
  const n = orderedPlayers.length;
  const numFull = Math.floor(n / podSize);

  for (let i = 0; i < numFull; i++) {
    groups.push(orderedPlayers.slice(i * podSize, (i + 1) * podSize));
  }

  const leftover = orderedPlayers.slice(numFull * podSize);
  const remainder = leftover.length;

  if (podSize >= 3) {
    if (remainder === 1 || remainder === 2) {
      for (const p of leftover) groups.push([p]);
    } else if (remainder === 3) {
      groups.push(leftover);
    }
  } else if (remainder === 1) {
    groups.push(leftover);
  }

  return groups.map(asPod);
}

// Fisher-Yates: cada permutação com a mesma probabilidade.
function shuffle(players) {
  const a = [...players];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Ordena por um critério, sorteando de verdade entre os empatados.
 *
 * O jeito tentador — `sort((a, b) => criterio || Math.random() - 0.5)` — não
 * funciona: um comparador aleatório não é uma ordem, e `sort` com ele devolve
 * permutações enviesadas. Medido neste projeto com 7 jogadores empatados: o
 * último da lista saía 27% das vezes e o segundo 4%.
 *
 * Embaralhar antes e ordenar com um comparador honesto dá o resultado certo,
 * porque `Array.prototype.sort` é estável: quem empata mantém a ordem sorteada.
 */
function rankWithRandomTiebreak(players, compare) {
  return shuffle(players).sort(compare);
}

// Map<playerId, Set<opponentId>> built from every past pairing (any round/podmate counts as an "opponent")
function buildOpponentHistory(pastPairings) {
  const history = new Map();
  for (const p of pastPairings) {
    const seats = [p.player1_id, p.player2_id, p.player3_id, p.player4_id].filter(Boolean);
    for (const a of seats) {
      if (!history.has(a)) history.set(a, new Set());
      for (const b of seats) if (b !== a) history.get(a).add(b);
    }
  }
  return history;
}

/**
 * Greedily build pods from an ordered player list, at each step picking the
 * partners that add the fewest new repeat-opponent pairs to the pod being
 * formed. Leaves whatever doesn't fill a final pod in `leftover`, in the
 * same relative order, for the caller to run through the usual bye logic.
 */
function greedyAvoidRepeats(orderedPlayers, podSize, history) {
  const remaining = [...orderedPlayers];
  const groups = [];
  while (remaining.length >= podSize) {
    const group = [remaining.shift()];
    for (let k = 1; k < podSize; k++) {
      let bestIdx = 0;
      let bestScore = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        let addedRepeats = 0;
        for (const g of group) if (history.get(g.id)?.has(cand.id)) addedRepeats++;
        if (addedRepeats < bestScore) {
          bestScore = addedRepeats;
          bestIdx = i;
          if (bestScore === 0) break;
        }
      }
      group.push(remaining.splice(bestIdx, 1)[0]);
    }
    groups.push(group);
  }
  return { groups, leftover: remaining };
}

function countRepeats(groups, history) {
  let count = 0;
  for (const g of groups) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        if (history.get(g[i].id)?.has(g[j].id)) count++;
      }
    }
  }
  return count;
}

/**
 * How many players are left without a pod once the field is chunked — i.e. how
 * many byes this round needs.
 */
function byeCountFor(playerCount, podSize) {
  const remainder = playerCount % podSize;
  if (podSize >= 3) return remainder === 1 || remainder === 2 ? remainder : 0;
  return remainder === 1 ? 1 : 0;
}

// Set of players who already received a bye at some point in this event.
function buildByeHistory(pastPairings) {
  const had = new Set();
  for (const p of pastPairings) {
    const alone = !p.player2_id && !p.player3_id && !p.player4_id;
    if ((p.result === 'bye' || alone) && p.player1_id) had.add(p.player1_id);
  }
  return had;
}

// Classificação oficial (MTR 2.3), a mesma exibida na tabela do evento. Os campos
// de desempate chegam prontos de services/standings.js; quando o chamador não os
// fornece (testes de unidade, por exemplo), sobra a pontuação, que é o critério
// que mais importa.
const nz = (v) => (v === null || v === undefined ? 0 : v);
// A mesma tolerância dos standings, e pela mesma razão: uma diferença de 1e-16
// entre dois percentuais não é desempate, é ruído — e aqui ela decidiria quem
// leva o bye, que vale uma vitória inteira.
const byOfficialStanding = (a, b) =>
  b.points - a.points ||
  cmpPct(nz(a.omw), nz(b.omw)) ||
  cmpPct(nz(a.gwp), nz(b.gwp)) ||
  cmpPct(nz(a.ogw), nz(b.ogw));

/**
 * Pick who sits out this round, walking the standing from the bottom up: the
 * bye is a free win, so it goes to whoever is doing worst — but never twice to
 * the same player while someone else is still eligible. Only if every remaining
 * player has already had one does it fall back to the tail of the order.
 *
 * Returns the chosen players plus the rest, with their relative order intact.
 */
function pickByePlayers(ordered, count, hadBye) {
  if (count <= 0) return { byes: [], rest: ordered };

  const takenIdx = new Set();
  const chosen = [];
  for (let i = ordered.length - 1; i >= 0 && chosen.length < count; i--) {
    if (!hadBye.has(ordered[i].id)) { chosen.push(ordered[i]); takenIdx.add(i); }
  }
  for (let i = ordered.length - 1; i >= 0 && chosen.length < count; i--) {
    if (!takenIdx.has(i)) { chosen.push(ordered[i]); takenIdx.add(i); }
  }

  return { byes: chosen, rest: ordered.filter((_, i) => !takenIdx.has(i)) };
}

/**
 * Generate pod-based pairings for the next round.
 *
 * method:
 *   'swiss' (default)         — sort by points desc, chunk into pods (current behavior).
 *   'random'                  — ignore points entirely, fully random pods.
 *   'swiss-less-repetition'   — points-ordered, but greedily avoids repeat opponents.
 *   'avoid-repetition'        — fully random order, greedily avoids repeat opponents.
 *
 * `pastPairings` (all prior pairings for the event) feeds both the
 * repetition-avoiding methods and the bye history, which every method respects.
 *
 * Byes are resolved first, for all methods: whoever sits out is taken out of the
 * field before pairing, so the pods are built from a list that divides evenly.
 * That's what keeps a bye from landing on the same player twice while someone
 * else in the field has never had one.
 */
function generateSwissPairings(players, podSize = 2, method = 'swiss', pastPairings = []) {
  // Quem senta fora é decidido pela classificação, nunca pelo método de pareamento:
  // o bye vale uma vitória inteira, então não pode cair no líder porque o método
  // daquele evento embaralha. Empate exato — a rodada 1 inteira, por exemplo — sai
  // no sorteio, refeito a cada pareamento.
  const { byes, rest } = pickByePlayers(
    rankWithRandomTiebreak(players, byOfficialStanding),
    byeCountFor(players.length, podSize),
    buildByeHistory(pastPairings)
  );
  const byePods = byes.map((p) => asPod([p]));

  if (method === 'swiss-less-repetition' || method === 'avoid-repetition') {
    const history = buildOpponentHistory(pastPairings);
    // A single greedy pass can paint itself into a corner (locally-optimal
    // early pods forcing a repeat later), so try several random orderings
    // and keep whichever produces the fewest total repeat-opponent pairs.
    let best = null;
    let bestScore = Infinity;
    for (let attempt = 0; attempt < 30 && bestScore > 0; attempt++) {
      const attemptOrder = method === 'avoid-repetition'
        ? shuffle(rest)
        : rankWithRandomTiebreak(rest, byOfficialStanding);
      const candidate = greedyAvoidRepeats(attemptOrder, podSize, history);
      const score = countRepeats(candidate.groups, history);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best.groups.map(asPod).concat(chunkIntoPods(best.leftover, podSize), byePods);
  }

  // 'swiss' (Performance Pairing) e 'random' diferem só na ordem dos pods.
  const ordered = method === 'random'
    ? shuffle(rest)
    : rankWithRandomTiebreak(rest, byOfficialStanding);
  return chunkIntoPods(ordered, podSize).concat(byePods);
}

/**
 * Distribute already-seeded players (best seed first) across `numPods` pods
 * in snake/serpentine order (1,2,3,4 | 4,3,2,1 | ...) so top seeds don't
 * all land in the same pod together.
 */
function snakeSeedPods(players, podSize) {
  const n = players.length;
  const numPods = Math.ceil(n / podSize);
  const pods = Array.from({ length: numPods }, () => []);
  let idx = 0;
  let forward = true;
  while (idx < n) {
    const order = forward
      ? [...Array(numPods).keys()]
      : [...Array(numPods).keys()].reverse();
    for (const podIdx of order) {
      if (idx >= n) break;
      if (pods[podIdx].length < podSize) {
        pods[podIdx].push(players[idx]);
        idx++;
      }
    }
    forward = !forward;
  }
  return pods;
}

/**
 * Build single-elimination playoff pods from a list of players already
 * ordered best-seed-first.
 *
 * podSize === 2: classic bracket seeding (seed 1 vs seed N, 2 vs N-1, ...).
 * podSize >= 3: snake-seeded across pods so strength is spread out.
 * A lone leftover player (no partner) becomes a BYE pod (auto-win).
 */
function seedPlayoffPods(seededPlayers, podSize) {
  let groups;
  if (podSize === 2) {
    groups = [];
    let i = 0;
    let j = seededPlayers.length - 1;
    while (i < j) {
      groups.push([seededPlayers[i], seededPlayers[j]]);
      i++;
      j--;
    }
    if (i === j) groups.push([seededPlayers[i]]);
  } else {
    groups = snakeSeedPods(seededPlayers, podSize);
  }

  return groups.map(asPod);
}

/**
 * Quem avança de uma fase do mata-mata para a seguinte.
 *
 * Em duelo, o vencedor de cada mesa e pronto: 8 → 4 → 2 → campeão, a conta fecha
 * sozinha. Em mesa de quatro (Commander) não fecha — um Top 8 tem duas mesas,
 * logo dois vencedores, e a fase seguinte virava uma mesa de **dois jogadores**,
 * que não é Commander.
 *
 * Então, quando os vencedores não enchem a próxima mesa, ela é completada com
 * quem jogou a fase atual e não venceu, na ordem da classificação oficial e
 * pegando **um de cada mesa** antes de repetir mesa — assim as duas mesas do Top
 * 8 mandam um segundo colocado cada, e a final tem quatro jogadores.
 *
 * A alternativa seria só o vencedor avançar e o Top 8 sumir da lista em formato
 * de quatro; a loja preferiu manter o Top 8 e a mesa cheia.
 *
 * Quando os vencedores já enchem a próxima mesa, a lista sai **na ordem das
 * mesas**, como sempre foi: é o caminho do chaveamento (quem venceu a mesa 1
 * encontra quem venceu a mesa 2). Só quando é preciso completar é que a ordem
 * passa a ser a da classificação, que é o critério de quem entrou e também
 * distribui melhor a mesa nova.
 *
 * @param mesas          mesas da fase atual, cada uma com os ids dos assentos
 * @param vencedores     ids de quem venceu, um por mesa, na ordem das mesas
 * @param ordemOficial   ids na ordem da classificação (melhor primeiro)
 * @param podSize        tamanho da mesa do evento
 */
function jogadoresQueAvancam({ mesas, vencedores, ordemOficial, podSize }) {
  // Um vencedor só: acabou, é o campeão. Mesa de dois: o bracket já fecha.
  if (vencedores.length <= 1 || podSize < 3 || vencedores.length >= podSize) return vencedores;

  const posicao = new Map(ordemOficial.map((id, i) => [id, i]));
  const daClassificacao = (a, b) => (posicao.get(a) ?? Infinity) - (posicao.get(b) ?? Infinity);

  const perdedoresPorMesa = mesas.map((mesa) =>
    [mesa.player1_id, mesa.player2_id, mesa.player3_id, mesa.player4_id]
      .filter((id) => id && !vencedores.includes(id))
      .sort(daClassificacao)
  );

  const extras = [];
  const faltam = () => podSize - vencedores.length - extras.length;
  for (let volta = 0; faltam() > 0; volta++) {
    const antes = extras.length;
    for (const fila of perdedoresPorMesa) {
      if (faltam() === 0) break;
      if (fila[volta]) extras.push(fila[volta]);
    }
    // Ninguém novo nesta volta: acabaram os candidatos (mesa incompleta é melhor
    // que inventar jogador).
    if (extras.length === antes) break;
  }

  return [...vencedores, ...extras].sort(daClassificacao);
}

/* ==========================================================================
   Clã Fronto — pareamento por clãs
   ========================================================================== */

/**
 * Rota&ccedil;&atilde;o fechada para o caso de exatamente 4 cl&atilde;s.
 */
const MOLS4 = [
  [[0, 1, 2, 3], [1, 0, 3, 2], [2, 3, 0, 1], [3, 2, 1, 0]],
  [[0, 2, 3, 1], [1, 3, 2, 0], [2, 0, 1, 3], [3, 1, 0, 2]],
  [[0, 3, 1, 2], [1, 2, 0, 3], [2, 1, 3, 0], [3, 0, 2, 1]],
];

/**
 * Com exatamente 4 clãs não há escolha nenhuma sobre a composição das mesas:
 * toda mesa é obrigatoriamente um jogador de cada clã. A única liberdade é qual
 * jogador de cada clã vai para qual mesa — e é justamente aí que um algoritmo
 * guloso, decidindo uma rodada por vez, se enrosca: medido, ele deixa cerca de
 * 8 reencontros em 4 rodadas.
 *
 * Este caso tem solução exata conhecida. Três quadrados latinos mutuamente
 * ortogonais de ordem 4 produzem 4 rodadas em que cada jogador enfrenta os seus
 * 12 adversários possíveis exatamente uma vez — zero repetição, que é o que as
 * tabelas de referência do formato entregam.
 *
 * A garantia depende de uma coisa que não é óbvia: os quatro jogadores de cada
 * clã precisam ocupar as MESMAS posições nas quatro rodadas. O que os quadrados
 * organizam é a posição, não a pessoa. Ordenar por classificação a cada rodada
 * — que foi o que este código fez até aqui — faz as posições trocarem de dono no
 * meio da rotação e destrói a ortogonalidade: medido, 4 clãs saíam de 0 para
 * cerca de 24 reencontros em 4 rodadas, pior que o guloso que a rotação veio
 * substituir.
 *
 * Não há perda nenhuma em fixar a ordem. Numa rotação exata as rodadas 2 a 4 são
 * consequência da rodada 1, então reordenar por desempenho no meio não pode
 * melhorar o pareamento — só quebrá-lo. E na rodada 1 ninguém pontuou ainda, de
 * modo que a ordem por classificação já era um sorteio disfarçado.
 *
 * A ordem estável sai dos próprios ids (uuid): varia de torneio para torneio,
 * então dois eventos com o mesmo elenco não geram as mesmas mesas, e é imutável
 * dentro do evento, que é o que a rotação exige. Não precisa de estado novo.
 *
 * Da 5ª rodada em diante a repetição é inevitável (12 adversários, 12 encontros
 * por rodada acumulados) e o pareamento volta a ser o guloso.
 */
const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function rotate4Clans(playersByClan, roundIndex) {
  const clanIds = [...playersByClan.keys()].sort();
  const ranked = clanIds.map((id) => [...playersByClan.get(id)].sort(porId));
  const r = roundIndex % 4;

  return Array.from({ length: 4 }, (_, t) => {
    const seats = ranked.map((list, clan) => list[clan === 0 ? t : MOLS4[clan - 1][r][t]]);
    return asPod(seats);
  });
}

/**
 * Monta as mesas de uma rodada de Clã Fronto.
 *
 * A regra dura: cada mesa tem 4 jogadores de 4 clãs diferentes, e ninguém joga
 * contra o próprio clã. Como todo clã tem exatamente 4 jogadores e ninguém pode
 * desistir, o total é sempre múltiplo de 4 — não existe bye nem mesa menor.
 *
 * A ordem inicial vem do método configurado no evento (desempenho ou sorteio),
 * exatamente como nos outros formatos; a restrição de clã é aplicada por cima.
 *
 * Duas escolhas fazem o algoritmo funcionar:
 *
 *   1. A cada assento, atende primeiro o clã com MAIS jogadores ainda livres.
 *      Sem isso a rodada termina com quatro sobras do mesmo clã, que não formam
 *      mesa — é o jeito de nunca se pintar num canto.
 *   2. Dentro do clã escolhido, senta quem menos já enfrentou os que já estão
 *      naquela mesa. É a mesma ideia da anti-repetição dos outros formatos.
 *
 * Uma passada gulosa pode ser azarada, então tenta várias e fica com a que
 * somar menos reencontros — a mesma estratégia de `generateSwissPairings`.
 */
function generateClanPairings(players, method = 'swiss', pastPairings = [], attempts = 200, roundIndex = null) {
  if (players.length === 0) return [];
  if (players.length % 4 !== 0) {
    throw new Error('Clã Fronto exige um número de jogadores múltiplo de 4');
  }

  const history = buildOpponentHistory(pastPairings);
  const clansOf = (list) => {
    const byClan = new Map();
    for (const p of list) {
      if (!byClan.has(p.clan_id)) byClan.set(p.clan_id, []);
      byClan.get(p.clan_id).push(p);
    }
    return byClan;
  };

  const byClan = clansOf(players);
  if (byClan.size < 4) {
    throw new Error('Clã Fronto exige pelo menos 4 clãs');
  }

  // 4 clãs nas 4 primeiras rodadas: usa a rotação exata em vez de procurar.
  const round = roundIndex ?? Math.floor(pastPairings.length / Math.max(players.length / 4, 1));
  if (byClan.size === 4 && round < 4 && method !== 'random') {
    return rotate4Clans(byClan, round);
  }

  let best = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < attempts && bestScore > 0; attempt++) {
    const ordered = method === 'random' || method === 'avoid-repetition'
      ? shuffle(players)
      : rankWithRandomTiebreak(players, byOfficialStanding);

    const remaining = clansOf(ordered);
    const tables = [];
    let failed = false;

    while (!failed && [...remaining.values()].some((v) => v.length)) {
      const table = [];
      for (let seat = 0; seat < 4; seat++) {
        // Clãs ainda com gente, o mais "cheio" primeiro, e nunca um já sentado nesta mesa.
        // Embaralhar antes da ordenação estável desempata clãs de mesmo tamanho por
        // sorteio — sem isso, com pontuações todas distintas, as tentativas seguintes
        // repetiriam exatamente a primeira e a busca não exploraria nada.
        const usedClans = new Set(table.map((p) => p.clan_id));
        const candidates = shuffle(
          [...remaining.entries()].filter(([, list]) => list.length > 0)
        )
          .filter(([clanId]) => !usedClans.has(clanId))
          .sort((a, b) => b[1].length - a[1].length);

        if (candidates.length === 0) { failed = true; break; }

        const [, list] = candidates[0];
        // menor número de reencontros com quem já está na mesa; empate resolvido por sorteio
        const cost = (p) => table.reduce((sum, seated) => sum + (history.get(seated.id)?.has(p.id) ? 1 : 0), 0);
        const cheapest = Math.min(...list.map(cost));
        const pool = list.filter((p) => cost(p) === cheapest);
        const pick = pool[Math.floor(Math.random() * pool.length)];

        table.push(pick);
        list.splice(list.indexOf(pick), 1);
      }
      if (!failed) tables.push(table);
    }

    if (failed) continue;
    const score = countRepeats(tables, history);
    if (score < bestScore) {
      bestScore = score;
      best = tables;
    }
  }

  if (!best) throw new Error('Não foi possível montar as mesas respeitando os clãs');
  return best.map(asPod);
}

/**
 * Monta as mesas de uma rodada de Partner.
 *
 * Aqui não há algoritmo novo: o partner é o suíço que já existe com a **dupla no
 * lugar do jogador** e mesa de dois. Os quatro métodos configuráveis, o bye pela
 * classificação, o sorteio honesto no empate e a anti-repetição vêm todos de
 * `generateSwissPairings` sem uma linha nova de pareamento.
 *
 * O trabalho é de tradução, e são três passos:
 *
 *   1. Cada dupla vira uma entidade com os campos que a ordenação oficial lê
 *      (`points`, `omw`, `gwp`, `ogw`) — vindos da classificação de times.
 *   2. As mesas passadas são reescritas no nível da dupla. Sem isso a
 *      anti-repetição mediria reencontros entre pessoas, e no partner as pessoas
 *      de uma dupla se reencontram em toda rodada por definição.
 *   3. Cada `dupla A × dupla B` é expandida em quatro assentos, com os parceiros
 *      em 1-3 e 2-4 — a convenção que o mata-mata do Clã Fronto já usa e que
 *      `winningSide()` já sabe ler.
 *
 * O bye existe, ao contrário do Clã Fronto: com número ímpar de duplas alguém
 * folga, e a mesa fica com os dois parceiros e nenhum adversário.
 */
function generatePartnerPairings(teams, method = 'swiss', pastPairings = []) {
  if (teams.length === 0) return [];

  const incompleta = teams.find((t) => t.players.length !== 2);
  if (incompleta) {
    throw new Error(`A dupla ${incompleta.name ?? incompleta.id} não tem dois jogadores`);
  }

  // (1) a dupla como entidade de pareamento
  const entidades = teams.map((t) => ({
    id: t.id,
    display_name: t.name ?? t.id,
    points: t.points ?? 0,
    omw: t.omw ?? null,
    gwp: t.gwp ?? null,
    ogw: t.ogw ?? null,
  }));

  // (2) o histórico no nível da dupla
  const timeDoJogador = new Map();
  for (const t of teams) for (const p of t.players) timeDoJogador.set(p.id, t.id);
  const mesasDeTimes = pastPairings.map((mesa) => {
    const vistos = [];
    for (const col of ['player1_id', 'player2_id', 'player3_id', 'player4_id']) {
      const timeId = mesa[col] ? timeDoJogador.get(mesa[col]) : null;
      if (timeId && !vistos.includes(timeId)) vistos.push(timeId);
    }
    return {
      player1_id: vistos[0] ?? null,
      player2_id: vistos[1] ?? null,
      player3_id: null,
      player4_id: null,
      result: mesa.result,
    };
  });

  // (3) o suíço de sempre, e a expansão em assentos
  const porId = new Map(teams.map((t) => [t.id, t]));
  const pods = generateSwissPairings(entidades, 2, method, mesasDeTimes);

  return pods.map((pod) => {
    const [a1, a2] = porId.get(pod.player1.id).players;
    if (!pod.player2) {
      // Bye: a dupla inteira folga. `insertPods` reconhece a mesa pela ausência
      // do segundo assento, e os dois parceiros levam a vitória.
      return { player1: a1, player2: null, player3: a2, player4: null };
    }
    const [b1, b2] = porId.get(pod.player2.id).players;
    return { player1: a1, player2: b1, player3: a2, player4: b2 };
  });
}

/**
 * Monta as mesas de uma fase de playoff do Clã Fronto.
 *
 * Aqui a mesa muda de natureza: são 2 clãs, com 2 jogadores cada, jogando em
 * parceria. Companheiro de clã senta junto em vez de enfrentar.
 *
 * `seededClans` vem ordenado do melhor colocado ao pior, cada um com os seus
 * dois representantes. O cruzamento é o clássico de chaveamento — melhor contra
 * pior — para que os dois primeiros só se encontrem na final.
 */
function seedClanPlayoffPods(seededClans) {
  const pods = [];
  let i = 0;
  let j = seededClans.length - 1;
  while (i < j) {
    const [a1, a2] = seededClans[i].players;
    const [b1, b2] = seededClans[j].players;
    // assentos alternados: parceiros em 1-3 e 2-4, como se sentariam à mesa
    pods.push({ player1: a1, player2: b1, player3: a2, player4: b2 });
    i++;
    j--;
  }
  return pods;
}

/**
 * Dado um pareamento de playoff em duplas e o clã vencedor, diz quem ganhou e
 * quem perdeu. Os dois parceiros compartilham o resultado da mesa.
 */
function clanPairSeats(pairing, playersById) {
  const seats = [pairing.player1_id, pairing.player2_id, pairing.player3_id, pairing.player4_id].filter(Boolean);
  const byClan = new Map();
  for (const id of seats) {
    const clanId = playersById.get(id)?.clan_id;
    if (!clanId) continue;
    if (!byClan.has(clanId)) byClan.set(clanId, []);
    byClan.get(clanId).push(id);
  }
  return byClan;
}

module.exports = {
  generateSwissPairings,
  seedPlayoffPods,
  jogadoresQueAvancam,
  generateClanPairings,
  generatePartnerPairings,
  seedClanPlayoffPods,
  clanPairSeats,
};
