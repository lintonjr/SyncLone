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

  return groups.map((g) => ({
    player1: g[0] ?? null,
    player2: g[1] ?? null,
    player3: g[2] ?? null,
    player4: g[3] ?? null,
  }));
}

function shuffle(players) {
  const a = [...players];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
 * Generate pod-based pairings for the next round.
 *
 * method:
 *   'swiss' (default)         — sort by points desc, chunk into pods (current behavior).
 *   'random'                  — ignore points entirely, fully random pods.
 *   'swiss-less-repetition'   — points-ordered, but greedily avoids repeat opponents.
 *   'avoid-repetition'        — fully random order, greedily avoids repeat opponents.
 *
 * `pastPairings` (all prior pairings for the event) is only needed for the
 * two repetition-avoiding methods.
 */
function generateSwissPairings(players, podSize = 2, method = 'swiss', pastPairings = []) {
  if (method === 'random') {
    return chunkIntoPods(shuffle(players), podSize);
  }

  if (method === 'swiss-less-repetition' || method === 'avoid-repetition') {
    const history = buildOpponentHistory(pastPairings);
    // A single greedy pass can paint itself into a corner (locally-optimal
    // early pods forcing a repeat later), so try several random orderings
    // and keep whichever produces the fewest total repeat-opponent pairs.
    let best = null;
    let bestScore = Infinity;
    for (let attempt = 0; attempt < 30 && bestScore > 0; attempt++) {
      const ordered = method === 'avoid-repetition'
        ? shuffle(players)
        : [...players].sort((a, b) => b.points - a.points || Math.random() - 0.5);
      const candidate = greedyAvoidRepeats(ordered, podSize, history);
      const score = countRepeats(candidate.groups, history);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    const pods = best.groups.map((g) => ({
      player1: g[0] ?? null,
      player2: g[1] ?? null,
      player3: g[2] ?? null,
      player4: g[3] ?? null,
    }));
    return pods.concat(chunkIntoPods(best.leftover, podSize));
  }

  // Default: Swiss (Performance Pairing)
  const sorted = [...players].sort((a, b) => b.points - a.points || Math.random() - 0.5);
  return chunkIntoPods(sorted, podSize);
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

  return groups.map((g) => ({
    player1: g[0] ?? null,
    player2: g[1] ?? null,
    player3: g[2] ?? null,
    player4: g[3] ?? null,
  }));
}

module.exports = { generateSwissPairings, seedPlayoffPods };
