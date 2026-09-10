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
const byOfficialStanding = (a, b) =>
  b.points - a.points ||
  nz(b.omw) - nz(a.omw) ||
  nz(b.gwp) - nz(a.gwp) ||
  nz(b.ogw) - nz(a.ogw);

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

module.exports = { generateSwissPairings, seedPlayoffPods };
