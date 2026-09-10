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
const { clanPairSeats } = require('./pairing');

const FLOOR = 1 / 3;

const SEATS = ['player1_id', 'player2_id', 'player3_id', 'player4_id'];
const WINNER_COLUMN = { player1: 'player1_id', player2: 'player2_id', player3: 'player3_id', player4: 'player4_id' };

/**
 * Quem ganhou a mesa, e quem estava do mesmo lado.
 *
 * Numa mesa comum é o assento apontado por `result`, sozinho. Na mesa de duplas
 * do playoff de Clã Fronto são dois: o assento apontado e o companheiro de clã.
 * A forma da mesa entrega qual é qual — quatro assentos repartidos em exatamente
 * dois clãs, dois de cada, só acontece no mata-mata em duplas; a rodada normal
 * do formato tem sempre quatro clãs distintos.
 *
 * Isto precisa viver aqui porque é aqui que os pontos são contados. Enquanto a
 * pontuação era uma coluna somada pela rota, só a rota conhecia a regra — e ao
 * derivar os pontos o companheiro deixava de receber a vitória.
 */
function winningSide(pairing, winnerId, playersById) {
  const grupos = clanPairSeats(pairing, playersById);
  const clan = playersById.get(winnerId)?.clan_id;
  if (!clan || grupos.size !== 2) return [winnerId];

  const lado = grupos.get(clan) ?? [winnerId];
  return lado.length === 2 ? lado : [winnerId];
}

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
      swissRoundsSeated: new Set(),
    });
  }

  // Em quantas rodadas SUÍÇAS o jogador teve assento, independente de já haver
  // resultado. É o que identifica quem entrou depois do torneio começar —
  // comparar `matches` com a rodada atual não serve: com a rodada em andamento e
  // nenhum resultado lançado, o campo inteiro apareceria como atrasado.
  //
  // O mata-mata fica de fora de propósito. Ele é seletivo: quem não passou para
  // o Top 4 tem uma rodada a menos por ter sido eliminado, não por ter chegado
  // tarde — e contá-lo marcava metade do campo como entrada tardia no instante
  // em que o playoff começava.
  for (const pairing of pairings) {
    if (!pairing.round_id || pairing.is_playoff) continue;
    for (const col of SEATS) {
      const id = pairing[col];
      if (id && stats.has(id)) stats.get(id).swissRoundsSeated.add(pairing.round_id);
    }
  }

  const playersById = new Map(players.map((p) => [p.id, p]));

  for (const pairing of pairings) {
    if (!pairing.result || pairing.result_status !== 'confirmed') continue;

    const seats = SEATS.map((c) => pairing[c]).filter(Boolean);
    const seated = seats.filter((id) => stats.has(id));
    if (seated.length === 0) continue;

    // Um bye é uma vitória sem adversário: conta como rodada jogada, mas ninguém
    // entra na lista de oponentes (MTR: byes não afetam os desempates de ninguém).
    const isBye = pairing.result === 'bye';
    const winnerId = WINNER_COLUMN[pairing.result] ? pairing[WINNER_COLUMN[pairing.result]] : null;

    // Em mesa de duplas os dois parceiros compartilham o resultado, e um não é
    // adversário do outro para efeito de desempate.
    const vencedores = winnerId ? new Set(winningSide(pairing, winnerId, playersById)) : new Set();
    const parceiroDe = (id) => (vencedores.has(id) ? vencedores : null);

    for (const id of seated) {
      const s = stats.get(id);
      s.matches += 1;
      if (isBye) s.matchPoints += pointsWin;
      else if (pairing.result === 'draw') s.matchPoints += pointsDraw;
      else s.matchPoints += vencedores.has(id) ? pointsWin : pointsLoss;

      if (!isBye) {
        const meuLado = parceiroDe(id);
        for (const other of seated) {
          if (other === id) continue;
          if (meuLado?.has(other)) continue; // companheiro de dupla, não adversário
          s.opponents.add(other);
        }
      }
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
      // Os pontos saem daqui, e só daqui. Eles já eram recalculados para o MW%;
      // o que existia em paralelo era uma coluna somada resultado a resultado com
      // a escala vigente naquele instante. As duas concordavam enquanto ninguém
      // mexia na pontuação do evento — e discordavam em silêncio assim que alguém
      // mexia, deixando dois jogadores com o mesmo cartel e totais diferentes.
      points: s.matchPoints,
      matches_played: s.matches,
      swiss_rounds_seated: s.swissRoundsSeated.size,
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

/**
 * Classificação de clãs do Clã Fronto.
 *
 * A pontuação do clã é a soma dos seus quatro jogadores — é ela que ordena a
 * tabela principal do torneio. O desempate reaproveita a ordem oficial do
 * individual, agregada pelos membros: vence quem, no conjunto, enfrentou
 * adversários mais fortes.
 *
 * Recebe os jogadores já enriquecidos por `computeStandings`, para não recalcular
 * os desempates duas vezes.
 */
function computeClanStandings(rankedPlayers, clans) {
  const media = (valores) => {
    const v = valores.filter((x) => x !== null && x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  const linhas = clans.map((clan) => {
    const membros = rankedPlayers.filter((p) => p.clan_id === clan.id);
    return {
      id: clan.id,
      name: clan.name,
      players: membros,
      player_count: membros.length,
      points: membros.reduce((sum, p) => sum + p.points, 0),
      wins: membros.reduce((sum, p) => sum + p.wins, 0),
      losses: membros.reduce((sum, p) => sum + p.losses, 0),
      draws: membros.reduce((sum, p) => sum + p.draws, 0),
      mwp: media(membros.map((p) => p.mwp)),
      omw: media(membros.map((p) => p.omw)),
      gwp: media(membros.map((p) => p.gwp)),
      ogw: media(membros.map((p) => p.ogw)),
    };
  });

  const or = (v, fallback) => (v === null || v === undefined ? fallback : v);
  linhas.sort((a, b) =>
    b.points - a.points ||
    or(b.omw, 0) - or(a.omw, 0) ||
    or(b.gwp, 0) - or(a.gwp, 0) ||
    or(b.ogw, 0) - or(a.ogw, 0) ||
    a.name.localeCompare(b.name)
  );

  return linhas;
}

module.exports = { computeStandings, computeClanStandings };
