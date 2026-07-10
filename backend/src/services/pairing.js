/**
 * Generate pod-based Swiss pairings.
 *
 * podSize >= 3 (Commander/multiplayer):
 *   - Fill as many full pods of `podSize` as possible.
 *   - Remainder 0 : nothing extra.
 *   - Remainder 1 : 1 BYE (auto-win, no opponent).
 *   - Remainder 2 : 2 separate BYEs (each player auto-wins).
 *   - Remainder 3 : 1 smaller pod of 3.
 *
 * podSize = 2 (1v1):
 *   - Pair players sequentially; odd player out gets BYE.
 */
function generateSwissPairings(players, podSize = 2) {
  const sorted = [...players].sort((a, b) => b.points - a.points || Math.random() - 0.5);
  const pods = [];
  const n = sorted.length;
  const numFull = Math.floor(n / podSize);
  const remainder = n % podSize;

  // Fill full pods
  for (let i = 0; i < numFull; i++) {
    const g = sorted.slice(i * podSize, (i + 1) * podSize);
    pods.push({
      player1: g[0] ?? null,
      player2: g[1] ?? null,
      player3: g[2] ?? null,
      player4: g[3] ?? null,
    });
  }

  const leftover = sorted.slice(numFull * podSize);

  if (podSize >= 3) {
    if (remainder === 1 || remainder === 2) {
      // Each leftover player gets an individual BYE
      for (const p of leftover) {
        pods.push({ player1: p, player2: null, player3: null, player4: null });
      }
    } else if (remainder === 3) {
      // Form a smaller pod of 3
      pods.push({
        player1: leftover[0],
        player2: leftover[1],
        player3: leftover[2],
        player4: null,
      });
    }
  } else {
    // 1v1: single leftover player gets BYE
    if (leftover.length === 1) {
      pods.push({ player1: leftover[0], player2: null, player3: null, player4: null });
    }
  }

  return pods;
}

module.exports = { generateSwissPairings };
