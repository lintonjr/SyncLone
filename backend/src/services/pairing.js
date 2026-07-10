/**
 * Swiss pairing algorithm.
 * Players are sorted by points desc, then paired sequentially.
 * If odd number, last player gets a bye.
 */
function generateSwissPairings(players) {
  const sorted = [...players].sort((a, b) => b.points - a.points || Math.random() - 0.5);
  const pairings = [];
  const used = new Set();

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(sorted[i].id)) continue;
    let paired = false;
    for (let j = i + 1; j < sorted.length; j++) {
      if (!used.has(sorted[j].id)) {
        pairings.push({ player1: sorted[i], player2: sorted[j] });
        used.add(sorted[i].id);
        used.add(sorted[j].id);
        paired = true;
        break;
      }
    }
    if (!paired) {
      pairings.push({ player1: sorted[i], player2: null }); // bye
      used.add(sorted[i].id);
    }
  }

  return pairings;
}

module.exports = { generateSwissPairings };
