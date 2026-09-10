/**
 * Standings e desempates no estilo MTR (Magic Tournament Rules, seção 2.3).
 *
 * A ordem oficial é: pontos de match → OMW% → GW% → OGW%. Os três percentuais
 * têm piso de 33%: sem isso, um jogador que perdeu tudo puxaria a média dos
 * adversários para baixo e transformaria "enfrentei alguém fraco" numa punição
 * maior do que a própria derrota.
 *
 * Só resultados **confirmados** entram. Um resultado auto-reportado que o
 * organizador ainda não aprovou não move pontos (routes/events.js) e também não
 * pode mover desempate.
 */
const FLOOR = 1 / 3;

const SEATS = ['player1_id', 'player2_id', 'player3_id', 'player4_id'];
const WINNER_COLUMN = { player1: 'player1_id', player2: 'player2_id', player3: 'player3_id', player4: 'player4_id' };

/**
 * Recebe TODOS os jogadores do evento (inclusive dropados: eles continuam
 * contando como adversários de quem ficou) e devolve uma cópia de cada um com
 * as métricas anexadas, já ordenada pela ordem oficial.
 */
function computeStandings(players, pairings, event) {
  const pointsWin = event.points_win ?? 3;
  const pointsDraw = event.points_draw ?? 1;
  const pointsLoss = event.points_loss ?? 0;

  // playerId -> acumuladores
  const stats = new Map();
  for (const p of players) {
    stats.set(p.id, {
      matches: 0,
      matchPoints: 0,
      gamesWon: 0,
      gamesPlayed: 0,
      opponents: new Set(),
    });
  }

  for (const pairing of pairings) {
    if (!pairing.result || pairing.result_status !== 'confirmed') continue;

    const seats = SEATS.map((c) => pairing[c]).filter(Boolean);
    const seated = seats.filter((id) => stats.has(id));
    if (seated.length === 0) continue;

    // Um bye é uma vitória sem adversário: conta como rodada jogada, mas ninguém
    // entra na lista de oponentes (MTR: byes não afetam os desempates de ninguém).
    const isBye = pairing.result === 'bye';
    const winnerId = WINNER_COLUMN[pairing.result] ? pairing[WINNER_COLUMN[pairing.result]] : null;

    for (const id of seated) {
      const s = stats.get(id);
      s.matches += 1;
      if (isBye) s.matchPoints += pointsWin;
      else if (pairing.result === 'draw') s.matchPoints += pointsDraw;
      else s.matchPoints += id === winnerId ? pointsWin : pointsLoss;

      if (!isBye) for (const other of seated) if (other !== id) s.opponents.add(other);
    }

    // Placar por games só existe em mesa 1v1, e só quando o organizador registrou.
    const g1 = pairing.p1_games;
    const g2 = pairing.p2_games;
    if (g1 !== null && g1 !== undefined && g2 !== null && g2 !== undefined && pairing.player2_id) {
      const total = g1 + g2;
      if (total > 0) {
        for (const [seat, won] of [[pairing.player1_id, g1], [pairing.player2_id, g2]]) {
          const s = stats.get(seat);
          if (!s) continue;
          s.gamesWon += won;
          s.gamesPlayed += total;
        }
      }
    } else if (isBye) {
      // MTR: um bye conta como 2-0 para o GW% de quem o recebeu.
      const s = stats.get(pairing.player1_id);
      if (s) { s.gamesWon += 2; s.gamesPlayed += 2; }
    }
  }

  const matchWinPct = (id) => {
    const s = stats.get(id);
    if (!s || s.matches === 0) return FLOOR;
    const max = s.matches * pointsWin;
    if (max <= 0) return FLOOR;
    return Math.max(s.matchPoints / max, FLOOR);
  };

  // null quando o jogador não tem nenhum game registrado: a coluna mostra "—" e
  // o critério simplesmente não desempata ninguém naquele evento.
  const gameWinPct = (id) => {
    const s = stats.get(id);
    if (!s || s.gamesPlayed === 0) return null;
    return Math.max(s.gamesWon / s.gamesPlayed, FLOOR);
  };

  const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

  const enriched = players.map((p) => {
    const s = stats.get(p.id);
    const opponents = [...s.opponents];
    const oppGwp = opponents.map(gameWinPct).filter((v) => v !== null);
    return {
      ...p,
      matches_played: s.matches,
      mwp: matchWinPct(p.id),
      omw: average(opponents.map(matchWinPct)),
      gwp: gameWinPct(p.id),
      ogw: oppGwp.length ? average(oppGwp) : null,
    };
  });

  // Ordem oficial, com nulos tratados como "não desempata" (valor neutro) e o
  // nome como último critério, para a listagem não trocar de ordem a cada request.
  const or = (v, fallback) => (v === null || v === undefined ? fallback : v);
  enriched.sort((a, b) =>
    b.points - a.points ||
    or(b.omw, 0) - or(a.omw, 0) ||
    or(b.gwp, 0) - or(a.gwp, 0) ||
    or(b.ogw, 0) - or(a.ogw, 0) ||
    a.display_name.localeCompare(b.display_name)
  );

  return enriched;
}

module.exports = { computeStandings };
