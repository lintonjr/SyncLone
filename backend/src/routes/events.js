const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const db = require('../db');
const auth = require('../middleware/auth');
const requireOrganizer = require('../middleware/requireOrganizer');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { HttpError, asyncHandler } = require('../lib/http');
const { imageUpload, publicPath, removeFile } = require('../lib/uploads');
const {
  generateSwissPairings, seedPlayoffPods,
  generateClanPairings, generatePartnerPairings, seedClanPlayoffPods,
} = require('../services/pairing');
const { computeStandings, computeClanStandings, winningSide } = require('../services/standings');
const { notifyUsers, activeEventUserIds, pairingUserIds } = require('../services/notify');
const eventStream = require('../services/eventStream');

// A capa é uma foto: 5 MB. As regras de segurança do recebimento estão em
// lib/uploads.js, compartilhadas com quem mais receber imagem.
const upload = imageUpload({
  maxBytes: 5 * 1024 * 1024,
  mensagem: 'Cover image must be a PNG, JPEG, WebP or GIF',
});

const parseBool = (v) => v === 'true' || v === true || v === 1 || v === '1';

// `conn` is either the pool-backed `db` or a transaction handle — both expose the
// same query/get/run trio, so these helpers work inside and outside a transaction.
async function pendingResultsCount(conn, roundId) {
  const row = await conn.get(
    "SELECT COUNT(*) as cnt FROM pairings WHERE round_id = ? AND (result IS NULL OR result_status = 'pending')",
    [roundId]
  );
  return row.cnt;
}

// Insert pairings for a set of pods and auto-award any bye wins
async function insertPods(conn, eventId, roundId, pods) {
  for (let idx = 0; idx < pods.length; idx++) {
    const pod = pods[idx];
    const isBye = !pod.player2;
    await conn.run(
      `INSERT INTO pairings (id, round_id, event_id, player1_id, player2_id, player3_id, player4_id, table_number, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(), roundId, eventId,
        pod.player1?.id ?? null,
        pod.player2?.id ?? null,
        pod.player3?.id ?? null,
        pod.player4?.id ?? null,
        idx + 1,
        isBye ? 'bye' : null,
      ]
    );
  }
}

// "Final" (1 pod) / "Semifinals" (2 pods) / "Quarterfinals" (4 pods) / "Round of N" otherwise
function playoffStageLabel(playerCount, podSize) {
  const pods = Math.ceil(playerCount / podSize);
  if (pods <= 1) return 'Final';
  if (pods <= 2) return 'Semifinals';
  if (pods <= 4) return 'Quarterfinals';
  return `Round of ${playerCount}`;
}

// Loads an event and asserts the caller owns it.
async function ownedEvent(conn, eventId, userId) {
  const event = await conn.get('SELECT * FROM events WHERE id = ?', [eventId]);
  if (!event) throw new HttpError(404, 'Event not found', 'api.eventNotFound');
  if (event.owner_id !== userId) throw new HttpError(403, 'Forbidden', 'api.forbidden');
  return event;
}

// A finished event is a closed record: nothing may be added to it or altered in
// it. The one way back is Undo, which is deliberately exempt — it's the recovery
// path when a bracket was resolved by mistake.
function assertNotFinished(event) {
  if (event.status === 'completed') {
    throw new HttpError(400, 'This event has already finished', 'api.eventFinished');
  }
}

/**
 * A edição é a segunda exceção legítima ao evento encerrado — mas só para uma
 * coisa: reabrir. É pelo `PUT` que o `status` volta a `ongoing`, então bloquear
 * o verbo inteiro tiraria o caminho de volta; deixá-lo aberto, como estava,
 * permitia renomear, trocar de liga e mexer na pontuação de um torneio já
 * fechado — e a pontuação alimenta a classificação final.
 *
 * `campos` são as chaves realmente enviadas no corpo (o schema deixa tudo
 * opcional, então o que não veio não conta).
 */
function assertReopenOnly(event, campos) {
  if (event.status !== 'completed') return;
  const reabre = campos.includes('status') ;
  const outros = campos.filter((c) => c !== 'status');
  if (!reabre || outros.length) {
    throw new HttpError(400, 'Torneio encerrado: só é possível reabri-lo, sem alterar mais nada', 'api.reopenOnly');
  }
}

// Convenience for the many owner-only routes that also require a live event.
async function liveOwnedEvent(conn, eventId, userId) {
  const event = await ownedEvent(conn, eventId, userId);
  assertNotFinished(event);
  return event;
}

// Every pairing of an event, for the standings/tiebreaker calculation.
// `is_playoff` viaja junto com a mesa porque quem conta rodadas precisa saber
// distinguir uma rodada que todo mundo joga de uma que só alguns jogam.
// `ORDER BY` não é enfeite: sem ele o MySQL não promete ordem, e as médias dos
// desempates somam as mesmas parcelas em ordens diferentes a cada consulta. Duas
// leituras do mesmo evento caíam em bits diferentes, e o chaveamento do mata-mata
// discordava da tabela que o organizador estava vendo.
const eventPairings = (conn, eventId) =>
  conn.query(
    `SELECT p.*, r.is_playoff FROM pairings p
     JOIN rounds r ON r.id = p.round_id
     WHERE p.event_id = ?
     ORDER BY r.round_number, p.table_number, p.id`,
    [eventId]
  );

/* ---------------------------------------------------------------------------
   Clã Fronto
   --------------------------------------------------------------------------- */

// Dois formatos têm times dentro do evento, e quase tudo o que vale para um vale
// para o outro: inscrição em bloco, elenco trancado, tabela por time, campeão por
// time. O que muda é o tamanho do time e a forma da mesa — e é só isso que estas
// três funções precisam distinguir.
const TEAM_SIZES = { clafronto: 4, partner: 2 };
const teamSizeOf = (event) => TEAM_SIZES[event.tournament_format] ?? 0;
const isTeamFormat = (event) => teamSizeOf(event) > 0;
const isClanFormat = (event) => event.tournament_format === 'clafronto';
const isPartnerFormat = (event) => event.tournament_format === 'partner';

// O substantivo certo para cada formato, para as mensagens não falarem em "clã"
// num torneio de duplas.
const teamNoun = (event) => (isPartnerFormat(event) ? 'dupla' : 'clã');
const teamNounPlural = (event) => (isPartnerFormat(event) ? 'duplas' : 'clãs');

/**
 * As regras que o formato impõe sobre a configuração do evento, num lugar só.
 *
 * Antes isso vivia espalhado: a criação forçava mesa de 4 e desligava byes, a
 * edição não repetia nada disso, e a validação do playoff olhava só a estrutura
 * sem saber de que formato ela era. Cada lacuna virou um achado.
 */
const CLAN_PLAYOFFS = ['clan2', 'clan4'];
const PARTNER_PLAYOFFS = ['partner2', 'partner4', 'partner8'];
const STANDARD_PLAYOFFS = ['top4', 'top8', 'top16'];

function formatRules(tournamentFormat) {
  const clan = tournamentFormat === 'clafronto';
  const partner = tournamentFormat === 'partner';
  const teamSize = TEAM_SIZES[tournamentFormat] ?? 0;
  return {
    clan,
    partner,
    teamSize,
    // Os dois formatos de time sentam quatro à mesa: o Clã Fronto com quatro
    // clãs distintos, o partner com duas duplas.
    podSize: (informado) => (teamSize ? 4 : (parseInt(informado) || 2)),
    // Clã Fronto: todo clã tem quatro e ninguém sai, então o campo é sempre
    // múltiplo de quatro e folga não existe. Partner: com número ímpar de duplas
    // alguém precisa folgar, e desligar o bye travaria a rodada.
    allowByes: (informado) => {
      if (clan) return 0;
      if (partner) return 1;
      return parseBool(informado) ? 1 : 0;
    },
    playoffs: clan ? CLAN_PLAYOFFS : partner ? PARTNER_PLAYOFFS : STANDARD_PLAYOFFS,
  };
}

// Um playoff de clãs num evento comum (ou o contrário) não tem como funcionar:
// o chaveamento de um lê clãs, o do outro lê jogadores.
function assertPlayoffMatchesFormat(tournamentFormat, playoffStructure) {
  if (!playoffStructure || playoffStructure === 'none') return;
  const { teamSize, playoffs } = formatRules(tournamentFormat);
  if (!playoffs.includes(playoffStructure)) {
    throw new HttpError(
      400,
      teamSize
        ? `Este formato aceita apenas playoff de times (${playoffs.join(' ou ')}); recebido "${playoffStructure}"`
        : `Playoff de times só existe em Clã Fronto e Partner; use ${STANDARD_PLAYOFFS.join(', ')} ou nenhum`
    );
  }
}

// Quantos times o formato exige para a mesa fechar: o Clã Fronto precisa de
// quatro clãs distintos por mesa; o partner, de duas duplas.
const MIN_TEAMS = { clafronto: 4, partner: 2 };
const PLAYOFF_TEAM_COUNTS = { clan2: 2, clan4: 4, partner2: 2, partner4: 4, partner8: 8 };

const eventClans = (conn, eventId) =>
  conn.query('SELECT * FROM event_clans WHERE event_id = ? ORDER BY created_at', [eventId]);

// A mesa só fecha com times completos e em número suficiente: o Clã Fronto
// precisa de quatro clãs distintos por mesa, o partner de duas duplas.
async function assertTeamFieldReady(conn, event) {
  const tamanho = teamSizeOf(event);
  const minimo = MIN_TEAMS[event.tournament_format] ?? 0;
  const rows = await conn.query(
    `SELECT c.id, c.name, COUNT(p.id) AS total
     FROM event_clans c
     LEFT JOIN event_players p ON p.clan_id = c.id AND p.status = 'active'
     WHERE c.event_id = ? GROUP BY c.id, c.name`,
    [event.id]
  );
  if (rows.length < minimo) {
    throw new HttpError(400, `Este formato precisa de pelo menos ${minimo} ${teamNounPlural(event)} — há ${rows.length}`);
  }
  const incompleto = rows.find((r) => Number(r.total) !== tamanho);
  if (incompleto) {
    throw new HttpError(400, `${teamNoun(event) === 'dupla' ? 'A dupla' : 'O clã'} ${incompleto.name} tem ${incompleto.total} jogadores; todos precisam ter ${tamanho}`);
  }
  return rows;
}

/**
 * Quem venceu uma mesa de playoff em duplas.
 *
 * O `result` continua apontando um assento, como em qualquer mesa — mas aqui esse
 * assento representa a dupla inteira: o clã dele vence, o outro sai. É o que evita
 * uma coluna nova só para dizer "a dupla tal ganhou".
 */
function clanOfResult(pairing, playersById) {
  const seatOf = {
    player1: pairing.player1_id, player2: pairing.player2_id,
    player3: pairing.player3_id, player4: pairing.player4_id,
  };
  const seatId = seatOf[pairing.result];
  return seatId ? playersById.get(seatId)?.clan_id ?? null : null;
}

// Monta a fase seguinte do mata-mata a partir dos times que avançaram.
async function buildClanPlayoffRound(tx, event, clanIds, roundNumber, ranked, pairings) {
  const clans = await eventClans(tx, event.id);
  const porId = new Map(clans.map((c) => [c.id, c]));

  // ordem: melhor colocado primeiro, para o cruzamento ser 1º contra último
  const clanStandings = computeClanStandings(ranked, clans, pairings ?? [], event)
    .filter((c) => clanIds.includes(c.id));
  const seeded = clanStandings.map((c) => ({
    id: c.id,
    name: porId.get(c.id)?.name,
    // os dois melhores do clã na classificação individual
    players: ranked.filter((p) => p.clan_id === c.id && p.status === 'active').slice(0, 2),
  }));

  const incompleto = seeded.find((c) => c.players.length < 2);
  if (incompleto) {
    throw new HttpError(400, `O clã ${incompleto.name} não tem dois jogadores para o mata-mata`);
  }

  const stage = seeded.length <= 2 ? 'Final' : seeded.length <= 4 ? 'Semifinals' : `Round of ${seeded.length}`;
  const roundId = uuidv4();
  await tx.run(
    'INSERT INTO rounds (id, event_id, round_number, is_playoff, playoff_stage) VALUES (?, ?, ?, 1, ?)',
    [roundId, event.id, roundNumber, stage]
  );
  await insertPods(tx, event.id, roundId, seedClanPlayoffPods(seeded));
  return { roundId, stage, seeded };
}

// Os formatos de time trancam o elenco na inscrição: ninguém entra nem sai
// depois. Num partner a razão é ainda mais dura que no Clã Fronto — uma dupla
// que perde um integrante não tem como ocupar dois assentos numa mesa 2v2.
function assertClanRosterOpen(event, acao) {
  if (!isTeamFormat(event)) return;
  if (event.current_round > 0) {
    throw new HttpError(400, `Este formato não permite ${acao} com o torneio em andamento`);
  }
}

// Auth: get my events (must be before /:id)
router.get('/user/mine', auth, asyncHandler(async (req, res) => {
  const owned = await db.query(`
    SELECT e.*, (SELECT COUNT(*) FROM event_players ep WHERE ep.event_id = e.id AND ep.status = 'active') as player_count
    FROM events e WHERE e.owner_id = ? ORDER BY e.date ASC
  `, [req.user.id]);
  const joined = await db.query(`
    SELECT e.*, (SELECT COUNT(*) FROM event_players ep2 WHERE ep2.event_id = e.id AND ep2.status = 'active') as player_count
    FROM events e
    JOIN event_players ep ON ep.event_id = e.id
    WHERE ep.user_id = ? AND e.owner_id != ?
    ORDER BY e.date ASC
  `, [req.user.id, req.user.id]);
  res.json({ owned, joined });
}));

// Public: list events. Paginated by offset — the client keeps asking for the next
// page until a short page comes back, so no total count round-trip is needed.
const EVENTS_PAGE_SIZE = 24;
const EVENTS_MAX_PAGE_SIZE = 100;

router.get('/', asyncHandler(async (req, res) => {
  const { q, past } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || EVENTS_PAGE_SIZE, 1), EVENTS_MAX_PAGE_SIZE);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let sql = `SELECT e.*, u.display_name as owner_name, l.name as league_name,
    (SELECT COUNT(*) FROM event_players ep WHERE ep.event_id = e.id AND ep.status = 'active') as player_count
    FROM events e JOIN users u ON u.id = e.owner_id LEFT JOIN leagues l ON l.id = e.league_id WHERE e.test_event = 0`;
  const params = [];
  if (past === 'true') { sql += " AND (e.date < ? OR e.status = 'completed')"; params.push(now); }
  else { sql += " AND e.date >= ? AND e.status != 'completed'"; params.push(now); }
  if (q) {
    sql += ' AND (e.name LIKE ? OR e.description LIKE ? OR e.game LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  // LIMIT/OFFSET interpolados: já são inteiros saneados acima, e o driver não
  // aceita placeholder nessa posição em statements preparados.
  sql += ` ORDER BY e.date ASC LIMIT ${limit} OFFSET ${offset}`;
  res.json(await db.query(sql, params));
}));

// Public: get single event
router.get('/:id', asyncHandler(async (req, res) => {
  const event = await db.get(
    `SELECT e.*, u.display_name as owner_name, l.name as league_name
     FROM events e JOIN users u ON u.id = e.owner_id LEFT JOIN leagues l ON l.id = e.league_id
     WHERE e.id = ?`,
    [req.params.id]
  );
  if (!event) throw new HttpError(404, 'Event not found', 'api.eventNotFound');

  // LEFT JOIN so guest players (user_id = NULL) also appear.
  // `profile_public` acompanha para a tabela saber quando o nome leva a um
  // perfil: linkar para uma página que responde 403 seria pior que não linkar.
  // Convidados vêm com NULL, que a tela já trata como "sem perfil".
  const players = await db.query(
    `SELECT ep.*, COALESCE(u.display_name, ep.display_name) AS display_name,
            u.profile_public
     FROM event_players ep LEFT JOIN users u ON u.id = ep.user_id
     WHERE ep.event_id = ? ORDER BY ep.joined_at`,
    [req.params.id]
  );

  const rounds = await db.query(
    'SELECT * FROM rounds WHERE event_id = ? ORDER BY round_number',
    [req.params.id]
  );
  const pairings = rounds.length
    ? await db.query(
        `SELECT p.*,
           r.is_playoff,
           ep1.display_name as p1_name,
           ep2.display_name as p2_name,
           ep3.display_name as p3_name,
           ep4.display_name as p4_name
         FROM pairings p
         JOIN rounds r ON r.id = p.round_id
         LEFT JOIN event_players ep1 ON ep1.id = p.player1_id
         LEFT JOIN event_players ep2 ON ep2.id = p.player2_id
         LEFT JOIN event_players ep3 ON ep3.id = p.player3_id
         LEFT JOIN event_players ep4 ON ep4.id = p.player4_id
         WHERE p.event_id = ? ORDER BY r.round_number, p.table_number, p.id`,
        [req.params.id]
      )
    : [];

  // Quem venceu a mesa sai do servidor, assento a assento.
  //
  // Numa mesa comum é o assento que `result` aponta, e o cliente daria a mesma
  // resposta sozinho. Numa mesa de duplas são dois, e a regra que sabe disso
  // mora em `winningSide` — a mesma que distribui os pontos. Deixar o cliente
  // deduzir era pedir que ele reimplementasse a regra, que foi exatamente como o
  // C-05 nasceu: o card de pareamento marcava o parceiro do vencedor como
  // derrotado enquanto a tabela lhe dava a vitória.
  const seatOf = { player1: 'player1_id', player2: 'player2_id', player3: 'player3_id', player4: 'player4_id' };
  const porId = new Map(players.map((p) => [p.id, p]));
  for (const mesa of pairings) {
    const coluna = seatOf[mesa.result];
    const vencedores = coluna && mesa[coluna] ? winningSide(mesa, mesa[coluna], porId) : [];
    mesa.winner_ids = vencedores;
  }

  // Standings e desempates saem prontos do servidor: a mesma ordem alimenta a
  // tabela, o seeding dos playoffs e a exportação, sem cada cliente recalcular
  // (e divergir) por conta própria.
  const ranked = computeStandings(players, pairings, event);

  // Em Clã Fronto a tabela principal é a de clãs; a individual fica ao lado e
  // é ela que define os dois representantes de cada clã no mata-mata.
  let clans = [];
  let clanStandings = [];
  if (isTeamFormat(event)) {
    clans = await eventClans(db, req.params.id);
    clanStandings = computeClanStandings(ranked, clans, pairings, event);
  }

  res.json({
    ...event,
    players: ranked,
    rounds,
    pairings,
    clans,
    clan_standings: clanStandings,
    // Só as rodadas suíças: o mata-mata é seletivo por definição, e não jogar
    // uma fase eliminatória não diz nada sobre quando o jogador entrou.
    swiss_rounds_total: rounds.filter((r) => !r.is_playoff).length,
  });
}));

// Public: SSE stream — pings connected clients whenever this event changes so they know to refetch
router.get('/:id/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  eventStream.subscribe(req.params.id, res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    eventStream.unsubscribe(req.params.id, res);
  });
});

// Public: export the event as CSV — standings or every round's pairings.
// Same data the page shows, in the format a shop actually files after the event.
const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvRows = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const pct = (v) => (v === null || v === undefined ? '' : `${(v * 100).toFixed(1)}%`);
const slug = (name) => name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';

const EXPORT_TYPES = ['standings', 'pairings', 'clans'];

router.get('/:id/export', asyncHandler(async (req, res) => {
  const type = EXPORT_TYPES.includes(req.query.type) ? req.query.type : 'standings';

  const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
  if (!event) throw new HttpError(404, 'Event not found', 'api.eventNotFound');
  if (type === 'clans' && !isTeamFormat(event)) {
    throw new HttpError(400, 'A exportação por time só existe em torneios disputados por times', 'api.clanExportOnly');
  }

  const players = await db.query(
    `SELECT ep.*, COALESCE(u.display_name, ep.display_name) AS display_name
     FROM event_players ep LEFT JOIN users u ON u.id = ep.user_id WHERE ep.event_id = ?`,
    [req.params.id]
  );
  const pairings = await eventPairings(db, req.params.id);
  const ranked = computeStandings(players, pairings, event);

  // Em Clã Fronto o clã é a informação principal da planilha; nos outros formatos
  // a coluna não existe, para a exportação de sempre não mudar de forma.
  const comClas = isTeamFormat(event);
  const clans = comClas ? await eventClans(db, req.params.id) : [];
  const nomeDoCla = new Map(clans.map((c) => [c.id, c.name]));
  const claDe = (playerId) => {
    const jogador = players.find((p) => p.id === playerId);
    return jogador?.clan_id ? nomeDoCla.get(jogador.clan_id) ?? '' : '';
  };

  let rows;
  if (type === 'clans') {
    // A classificação principal do formato, que até agora não saía de jeito nenhum.
    rows = [['Rank', 'Clã', 'Jogadores', 'V', 'D', 'E', 'Pontos', 'MW%', 'OMW%', 'GW%', 'OGW%']];
    computeClanStandings(ranked, clans, pairings, event).forEach((c, i) => {
      rows.push([i + 1, c.name, c.player_count, c.wins, c.losses, c.draws, c.points,
        pct(c.mwp), pct(c.omw), pct(c.gwp), pct(c.ogw)]);
    });
  } else if (type === 'standings') {
    const cab = ['Rank', 'Player'];
    if (comClas) cab.push('Clã');
    rows = [[...cab, 'Deck', 'Status', 'W', 'L', 'D', 'Points', 'Matches', 'MW%', 'OMW%', 'GW%', 'OGW%']];
    const linha = (p, rank) => [
      rank, p.display_name,
      ...(comClas ? [claDe(p.id)] : []),
      p.deck_name ?? '', p.status, p.wins, p.losses, p.draws,
      p.points, p.matches_played, pct(p.mwp), pct(p.omw), pct(p.gwp), pct(p.ogw),
    ];
    ranked.filter((p) => p.status === 'active').forEach((p, i) => rows.push(linha(p, i + 1)));
    // Dropados vão no fim, sem posição: saíram da disputa mas fizeram parte dela.
    ranked.filter((p) => p.status === 'dropped').forEach((p) => rows.push(linha(p, '')));
  } else {
    const rounds = await db.query('SELECT * FROM rounds WHERE event_id = ? ORDER BY round_number', [req.params.id]);
    const roundOf = new Map(rounds.map((r) => [r.id, r]));
    const nameOf = new Map(players.map((p) => [p.id, p.display_name]));
    const winnerSeat = { player1: 1, player2: 2, player3: 3, player4: 4 };

    // Uma coluna de clã por assento: escrever "Nome (Clã)" na mesma célula seria
    // mais enxuto e inutilizaria o filtro de quem abrir a planilha.
    const cabAssentos = comClas
      ? ['Player 1', 'Clã 1', 'Player 2', 'Clã 2', 'Player 3', 'Clã 3', 'Player 4', 'Clã 4']
      : ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
    rows = [['Round', 'Stage', 'Table', ...cabAssentos, 'Result', 'Winner', 'Games', 'Status']];
    const ordered = [...pairings].sort(
      (a, b) => (roundOf.get(a.round_id)?.round_number ?? 0) - (roundOf.get(b.round_id)?.round_number ?? 0)
        || a.table_number - b.table_number
    );
    for (const p of ordered) {
      const round = roundOf.get(p.round_id);
      const seats = [p.player1_id, p.player2_id, p.player3_id, p.player4_id];
      const winnerId = winnerSeat[p.result] ? seats[winnerSeat[p.result] - 1] : null;
      const games = p.p1_games !== null && p.p2_games !== null ? `${p.p1_games}-${p.p2_games}` : '';
      rows.push([
        round?.round_number ?? '',
        round?.is_playoff ? (round.playoff_stage ?? 'Playoff') : 'Swiss',
        p.table_number,
        ...seats.flatMap((id) => {
          const nome = id ? nameOf.get(id) ?? '' : '';
          return comClas ? [nome, id ? claDe(id) : ''] : [nome];
        }),
        p.result ?? 'pending',
        winnerId ? nameOf.get(winnerId) ?? '' : '',
        games,
        p.result ? p.result_status : 'pending',
      ]);
    }
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slug(event.name)}-${type}.csv"`);
  // BOM: sem ele o Excel abre acentuação quebrada, que é onde esse arquivo vai parar.
  res.send('\ufeff' + csvRows(rows));
}));

// Auth: create event (organizer only)
router.post('/', auth, requireOrganizer, upload.single('thumbnail'), validate(schemas.createEvent), asyncHandler(async (req, res) => {
  const {
    name, description, city, address, online, date, game, format, tournament_format,
    pairing_method, playoff_structure, allow_byes, test_event,
    collaborative_deck, async_draws, confirm_players, qr_code_enabled, league_id, pod_size,
    points_win, points_draw, points_loss,
  } = req.body;

  let leagueIdVal = null;
  if (league_id) {
    const league = await db.get('SELECT * FROM leagues WHERE id = ?', [league_id]);
    if (!league) throw new HttpError(404, 'League not found', 'api.leagueNotFound');
    if (league.owner_id !== req.user.id) throw new HttpError(403, 'You can only attach events to your own leagues', 'api.leagueNotYours');
    leagueIdVal = league_id;
  }

  const id = uuidv4();
  const thumbnail = publicPath(req.file);
  const regras = formatRules(tournament_format || 'standard');
  assertPlayoffMatchesFormat(tournament_format || 'standard', playoff_structure);
  const podSizeVal = regras.podSize(pod_size);
  const pointsWinVal = points_win !== undefined && points_win !== '' ? parseInt(points_win) : 3;
  const pointsDrawVal = points_draw !== undefined && points_draw !== '' ? parseInt(points_draw) : 1;
  const pointsLossVal = points_loss !== undefined && points_loss !== '' ? parseInt(points_loss) : 0;

  await db.run(`
    INSERT INTO events (id, name, description, city, address, online, thumbnail, date, game, format,
      tournament_format, pairing_method, playoff_structure, allow_byes, test_event, collaborative_deck, async_draws,
      confirm_players, qr_code_enabled, league_id, pod_size, points_win, points_draw, points_loss, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, name, description || null, city || null, address || null,
    parseBool(online) ? 1 : 0, thumbnail, date, game, format || null,
    tournament_format || 'standard',
    pairing_method || 'swiss', playoff_structure || 'none',
    regras.allowByes(allow_byes), parseBool(test_event) ? 1 : 0,
    parseBool(collaborative_deck) ? 1 : 0, parseBool(async_draws) ? 1 : 0,
    parseBool(confirm_players) ? 1 : 0, parseBool(qr_code_enabled) ? 1 : 0, leagueIdVal, podSizeVal,
    pointsWinVal, pointsDrawVal, pointsLossVal, req.user.id,
  ]);

  res.status(201).json(await db.get('SELECT * FROM events WHERE id = ?', [id]));
}));

// Auth: update event (owner only)
router.put('/:id', auth, upload.single('thumbnail'), validate(schemas.updateEvent), asyncHandler(async (req, res) => {
  const event = await ownedEvent(db, req.params.id, req.user.id);

  // O schema deixa todo campo opcional, então o que chegou é o que o organizador
  // realmente quis mudar. A capa entra pelo multipart, fora do corpo.
  const camposEnviados = Object.keys(req.body).filter((k) => req.body[k] !== undefined);
  if (req.file) camposEnviados.push('thumbnail');
  assertReopenOnly(event, camposEnviados);

  const {
    name, description, city, address, online, date, game, format, tournament_format,
    pairing_method, pod_size, playoff_structure, allow_byes, test_event,
    collaborative_deck, async_draws, confirm_players, qr_code_enabled, league_id, status,
    points_win, points_draw, points_loss,
  } = req.body;

  let leagueIdVal = event.league_id;
  if (league_id !== undefined) {
    if (!league_id) {
      leagueIdVal = null;
    } else {
      const league = await db.get('SELECT * FROM leagues WHERE id = ?', [league_id]);
      if (!league) throw new HttpError(404, 'League not found', 'api.leagueNotFound');
      if (league.owner_id !== req.user.id) throw new HttpError(403, 'You can only attach events to your own leagues', 'api.leagueNotYours');
      leagueIdVal = league_id;
    }
  }

  const thumbnail = publicPath(req.file) ?? event.thumbnail;

  // Trocar de formato com o torneio em andamento quebraria os pareamentos já feitos.
  const formatoEfetivo = event.current_round > 0
    ? event.tournament_format
    : (tournament_format || event.tournament_format);

  // As travas do formato valem na edição tanto quanto na criação. Sem isto, salvar
  // o formulário devolvia um Clã Fronto com mesa de 2 — e a tela passava a desenhar
  // a mesa de quatro como duelo, escondendo metade dos jogadores.
  const regras = formatRules(formatoEfetivo);
  const playoffEfetivo = playoff_structure || event.playoff_structure;
  assertPlayoffMatchesFormat(formatoEfetivo, playoffEfetivo);

  const podSizeEfetivo = regras.clan
    ? 4
    : (pod_size ? parseInt(pod_size) : event.pod_size);
  const byesEfetivo = regras.clan
    ? 0
    : (allow_byes !== undefined ? (parseBool(allow_byes) ? 1 : 0) : event.allow_byes);

  await db.run(`
    UPDATE events SET name=?, description=?, city=?, address=?, online=?, thumbnail=?, date=?,
    game=?, format=?, tournament_format=?, pairing_method=?, pod_size=?, playoff_structure=?, allow_byes=?, test_event=?,
    collaborative_deck=?, async_draws=?, confirm_players=?, qr_code_enabled=?, league_id=?, points_win=?, points_draw=?, points_loss=?,
    status=? WHERE id=?
  `, [
    name || event.name, description ?? event.description, city ?? event.city,
    address ?? event.address, online !== undefined ? (parseBool(online) ? 1 : 0) : event.online,
    thumbnail, date || event.date, game || event.game, format ?? event.format,
    formatoEfetivo,
    pairing_method || event.pairing_method, podSizeEfetivo,
    playoffEfetivo,
    byesEfetivo,
    test_event !== undefined ? (parseBool(test_event) ? 1 : 0) : event.test_event,
    collaborative_deck !== undefined ? (parseBool(collaborative_deck) ? 1 : 0) : event.collaborative_deck,
    async_draws !== undefined ? (parseBool(async_draws) ? 1 : 0) : event.async_draws,
    confirm_players !== undefined ? (parseBool(confirm_players) ? 1 : 0) : event.confirm_players,
    qr_code_enabled !== undefined ? (parseBool(qr_code_enabled) ? 1 : 0) : event.qr_code_enabled,
    leagueIdVal,
    points_win !== undefined && points_win !== '' ? parseInt(points_win) : event.points_win,
    points_draw !== undefined && points_draw !== '' ? parseInt(points_draw) : event.points_draw,
    points_loss !== undefined && points_loss !== '' ? parseInt(points_loss) : event.points_loss,
    status || event.status, req.params.id,
  ]);

  // Reabrir devolve o torneio ao estado de disputa: o campeão registrado deixa de
  // valer, como já acontece no undo da rodada final.
  if (event.status === 'completed' && status && status !== 'completed') {
    await db.run('UPDATE events SET champion_id = NULL, champion_clan_id = NULL WHERE id = ?', [req.params.id]);
  }

  eventStream.broadcast(req.params.id);
  res.json(await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]));
}));

// Auth: delete event (owner only)
router.delete('/:id', auth, asyncHandler(async (req, res) => {
  const capa = await db.transaction(async (tx) => {
    const evento = await ownedEvent(tx, req.params.id, req.user.id);
    await tx.run('DELETE FROM pairings WHERE event_id = ?', [req.params.id]);
    await tx.run('DELETE FROM rounds WHERE event_id = ?', [req.params.id]);
    await tx.run('DELETE FROM event_players WHERE event_id = ?', [req.params.id]);
    // Os clãs vêm depois dos jogadores (que os referenciam) e antes do evento
    // (que eles referenciam). Sem esta linha, apagar um Clã Fronto estourava na
    // chave estrangeira e o evento ficava sem poder ser removido.
    await tx.run('DELETE FROM event_clans WHERE event_id = ?', [req.params.id]);
    await tx.run('DELETE FROM events WHERE id = ?', [req.params.id]);
    return evento.thumbnail;
  });

  // A capa some junto. Sem isto, cada evento apagado deixava a imagem no disco
  // para sempre — e não havia mais nenhuma linha apontando para ela.
  await removeFile(capa);

  // 'deleted' e não 'update': quem está com a tela aberta precisa sair, não
  // recarregar um evento que não existe mais.
  eventStream.broadcast(req.params.id, 'deleted');
  res.json({ message: 'Event deleted' });
}));

// Auth: join event
router.post('/:id/join', auth, asyncHandler(async (req, res) => {
  const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
  if (!event) throw new HttpError(404, 'Event not found', 'api.eventNotFound');
  if (event.status === 'completed') throw new HttpError(400, 'This event has already finished', 'api.eventFinished');
  if (isTeamFormat(event)) {
    throw new HttpError(
      400,
      `Neste torneio a inscrição é por ${teamNoun(event)}, com ${teamSizeOf(event)} jogadores de uma vez`,
      'api.joinByClan'
    );
  }
  const existing = await db.get(
    'SELECT id FROM event_players WHERE event_id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );
  if (existing) throw new HttpError(409, 'Already joined', 'api.alreadyJoined');

  const status = event.confirm_players ? 'pending' : 'active';
  await db.run(
    'INSERT INTO event_players (id, event_id, user_id, display_name, status) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), req.params.id, req.user.id, req.user.display_name, status]
  );
  eventStream.broadcast(req.params.id);
  res.status(201).json({ message: status === 'pending' ? 'Join request sent' : 'Joined event', pending: status === 'pending' });
}));

/**
 * Retires a player from an event.
 *
 * A player who has already been paired can't simply be deleted: the pairings
 * reference them, and the results they produced are already reflected in every
 * podmate's standing. Those players are marked 'dropped' — they stop being
 * paired and stop appearing in the standings, but the history stays intact and
 * the event page lists them under "Dropped Players". Only a player who never sat
 * at a table (a rejected join request, a last-minute cancellation) is deleted.
 */
async function retirePlayer(eventId, player) {
  const played = await db.get(
    `SELECT id FROM pairings
     WHERE event_id = ? AND (player1_id = ? OR player2_id = ? OR player3_id = ? OR player4_id = ?)
     LIMIT 1`,
    [eventId, player.id, player.id, player.id, player.id]
  );
  if (played) {
    await db.run("UPDATE event_players SET status = 'dropped' WHERE id = ?", [player.id]);
    return 'dropped';
  }
  await db.run('DELETE FROM event_players WHERE id = ?', [player.id]);
  return 'removed';
}

// Auth: leave event
router.delete('/:id/join', auth, asyncHandler(async (req, res) => {
  const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
  if (!event) throw new HttpError(404, 'Event not found', 'api.eventNotFound');
  assertNotFinished(event);
  assertClanRosterOpen(event, 'sair do torneio');

  const player = await db.get(
    'SELECT * FROM event_players WHERE event_id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );
  if (!player) return res.json({ message: 'Left event' });

  const outcome = await retirePlayer(req.params.id, player);
  eventStream.broadcast(req.params.id);
  res.json({ message: outcome === 'dropped' ? 'Dropped from event' : 'Left event', dropped: outcome === 'dropped' });
}));

// Auth: add player by email or guest name (owner only)
router.post('/:id/players', auth, validate(schemas.addPlayer), asyncHandler(async (req, res) => {
  const event = await liveOwnedEvent(db, req.params.id, req.user.id);
  if (isTeamFormat(event)) {
    throw new HttpError(
      400,
      `Neste torneio jogadores entram em ${teamNounPlural(event)} de ${teamSizeOf(event)}, não um a um`,
      'api.addByClan'
    );
  }

  const { email, display_name } = req.body;
  let userId = null;
  let name = display_name || 'Guest';

  if (email) {
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) throw new HttpError(404, 'User not found with that email');
    userId = user.id;
    name = user.display_name;
  }

  if (userId) {
    const existing = await db.get(
      'SELECT id FROM event_players WHERE event_id = ? AND user_id = ?',
      [req.params.id, userId]
    );
    if (existing) throw new HttpError(409, 'Player already in event');
  }

  const id = uuidv4();
  await db.run(
    'INSERT INTO event_players (id, event_id, user_id, display_name) VALUES (?, ?, ?, ?)',
    [id, req.params.id, userId, name]
  );
  if (userId) await notifyUsers(db, [userId], 'notif.addedToEvent', { evento: event.name });
  eventStream.broadcast(req.params.id);
  res.status(201).json(await db.get('SELECT * FROM event_players WHERE id = ?', [id]));
}));

/**
 * Clã Fronto: inscreve um clã inteiro.
 *
 * Dois caminhos, e nunca os dois juntos:
 *   - quatro e-mails de contas existentes, e quem envia precisa estar entre eles;
 *   - quatro nomes de convidado, e só o dono do evento pode usar esse caminho.
 *
 * Tudo é validado antes de gravar qualquer linha: um clã entra completo ou não
 * entra. Meio clã deixaria o torneio impossível de parear.
 */
router.post('/:id/clans', auth, validate(schemas.createClan), asyncHandler(async (req, res) => {
  const { name, emails, display_names } = req.body;

  const criado = await db.transaction(async (tx) => {
    const event = await tx.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) throw new HttpError(404, 'Event not found', 'api.eventNotFound');
    if (!isTeamFormat(event)) throw new HttpError(400, 'Este torneio não é disputado por times', 'api.notClanEvent');
    assertNotFinished(event);
    if (event.current_round > 0) {
      throw new HttpError(400, 'O torneio já começou: não é mais possível inscrever times', 'api.clanRosterClosed');
    }
    const tamanhoDoTime = teamSizeOf(event);

    const isOwner = event.owner_id === req.user.id;
    if (display_names && !isOwner) {
      throw new HttpError(403, `Só o organizador pode inscrever ${teamNoun(event) === 'dupla' ? 'uma dupla' : 'um clã'} de convidados`, 'api.guestClanOwnerOnly');
    }

    const jaExiste = await tx.get(
      'SELECT id FROM event_clans WHERE event_id = ? AND name = ?',
      [req.params.id, name]
    );
    if (jaExiste) throw new HttpError(409, `Já existe ${teamNoun(event) === 'dupla' ? 'uma dupla chamada' : 'um clã chamado'} ${name} neste torneio`);

    // --- resolve os quatro integrantes antes de gravar ---
    let membros;
    if (emails) {
      const normalizados = emails.map((e) => e.trim().toLowerCase());
      if (normalizados.length !== tamanhoDoTime || new Set(normalizados).size !== tamanhoDoTime) {
        throw new HttpError(400, `São ${tamanhoDoTime} e-mails, de pessoas diferentes`, 'api.clanEmailsDistinct');
      }
      if (!normalizados.includes(String(req.user.email).toLowerCase())) {
        throw new HttpError(403, `Você precisa fazer parte d${teamNoun(event) === 'dupla' ? 'a dupla' : 'o clã'} que está inscrevendo`, 'api.mustBeInClan');
      }

      const usuarios = await tx.query(
        `SELECT id, email, display_name FROM users WHERE LOWER(email) IN (${normalizados.map(() => '?').join(',')})`,
        normalizados
      );
      const porEmail = new Map(usuarios.map((u) => [u.email.toLowerCase(), u]));
      const faltando = normalizados.filter((e) => !porEmail.has(e));
      if (faltando.length) {
        throw new HttpError(404, `Sem conta cadastrada para: ${faltando.join(', ')}`);
      }

      const ids = normalizados.map((e) => porEmail.get(e).id);
      const jaInscritos = await tx.query(
        `SELECT ep.user_id, u.email FROM event_players ep JOIN users u ON u.id = ep.user_id
         WHERE ep.event_id = ? AND ep.user_id IN (${ids.map(() => '?').join(',')})`,
        [req.params.id, ...ids]
      );
      if (jaInscritos.length) {
        throw new HttpError(409, `Já inscrito neste torneio: ${jaInscritos.map((r) => r.email).join(', ')}`);
      }

      membros = normalizados.map((e) => {
        const u = porEmail.get(e);
        return { user_id: u.id, display_name: u.display_name };
      });
    } else {
      if (display_names.length !== tamanhoDoTime) {
        throw new HttpError(400, `São ${tamanhoDoTime} nomes`, 'api.clanNamesCount');
      }
      membros = display_names.map((nome) => ({ user_id: null, display_name: nome }));
    }

    const clanId = uuidv4();
    await tx.run('INSERT INTO event_clans (id, event_id, name) VALUES (?, ?, ?)', [clanId, req.params.id, name]);
    for (const m of membros) {
      await tx.run(
        'INSERT INTO event_players (id, event_id, clan_id, user_id, display_name) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), req.params.id, clanId, m.user_id, m.display_name]
      );
    }

    await notifyUsers(tx, membros.map((m) => m.user_id), 'notif.addedToClan', {
      cla: name,
      evento: event.name,
    });

    return { id: clanId, name, players: membros };
  });

  eventStream.broadcast(req.params.id);
  res.status(201).json(criado);
}));

// Clã Fronto: desfaz a inscrição de um clã inteiro, antes do torneio começar.
router.delete('/:id/clans/:clanId', auth, asyncHandler(async (req, res) => {
  await db.transaction(async (tx) => {
    const event = await ownedEvent(tx, req.params.id, req.user.id);
    if (!isTeamFormat(event)) throw new HttpError(400, 'Este torneio não é disputado por times', 'api.notClanEvent');
    if (event.current_round > 0) {
      throw new HttpError(400, 'O torneio já começou: o elenco está fechado');
    }
    const clan = await tx.get(
      'SELECT * FROM event_clans WHERE id = ? AND event_id = ?',
      [req.params.clanId, req.params.id]
    );
    if (!clan) throw new HttpError(404, 'Clã não encontrado');

    await tx.run('DELETE FROM event_players WHERE clan_id = ?', [req.params.clanId]);
    await tx.run('DELETE FROM event_clans WHERE id = ?', [req.params.clanId]);
  });

  eventStream.broadcast(req.params.id);
  res.json({ message: 'Clã removido' });
}));

// Auth: update player deck/status
/**
 * Vincula uma inscrição de convidado a uma conta.
 *
 * Metade do histórico do sistema está preso em convidados: pessoas que o
 * organizador inscreveu pelo nome, sem conta. Essas linhas não somam em liga
 * nenhuma e não têm perfil onde encostar — e não há como ligá-las
 * automaticamente, porque nada além do nome as identifica.
 *
 * Quem vincula é o organizador, e é ele de propósito: qualquer caminho em que o
 * próprio jogador reivindicasse uma inscrição permitiria reivindicar a dos
 * outros e inflar o próprio retrospecto. O organizador sabe quem é "Ana".
 *
 * A operação é permitida mesmo com o evento encerrado. É uma exceção deliberada,
 * como o undo: atribuir autoria não muda resultado nenhum — a linha mantém o
 * mesmo id, e as mesas e os resultados continuam apontando para ela. O que muda
 * é que aquela participação passa a contar nas somas entre eventos, e por isso a
 * ação precisa ser explícita e visível, nunca automática.
 */
router.put('/:id/players/:playerId/link', auth, validate(schemas.linkPlayer), asyncHandler(async (req, res) => {
  const vinculado = await db.transaction(async (tx) => {
    const event = await ownedEvent(tx, req.params.id, req.user.id);

    const player = await tx.get(
      'SELECT * FROM event_players WHERE id = ? AND event_id = ? FOR UPDATE',
      [req.params.playerId, req.params.id]
    );
    if (!player) throw new HttpError(404, 'Player not found', 'api.playerNotFound');
    if (player.user_id) {
      throw new HttpError(409, 'Esta inscrição já pertence a uma conta', 'api.playerAlreadyLinked');
    }

    const user = await tx.get('SELECT id, display_name FROM users WHERE email = ?', [req.body.email]);
    if (!user) throw new HttpError(404, 'User not found with that email', 'api.userNotFound');

    // A chave única do banco também barra isto, mas um 409 explicando é melhor
    // que um erro de driver traduzido.
    const jaEsta = await tx.get(
      'SELECT id FROM event_players WHERE event_id = ? AND user_id = ?',
      [req.params.id, user.id]
    );
    if (jaEsta) throw new HttpError(409, 'Esta conta já participa deste evento', 'api.accountAlreadyInEvent');

    await tx.run('UPDATE event_players SET user_id = ? WHERE id = ?', [user.id, req.params.playerId]);
    await notifyUsers(tx, [user.id], 'notif.guestLinked', {
      evento: event.name,
      nome: player.display_name,
    });

    return await tx.get('SELECT * FROM event_players WHERE id = ?', [req.params.playerId]);
  });

  eventStream.broadcast(req.params.id);
  res.json(vinculado);
}));

router.put('/:id/players/:playerId', auth, validate(schemas.updatePlayer), asyncHandler(async (req, res) => {
  const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
  if (!event) throw new HttpError(404, 'Event not found', 'api.eventNotFound');
  assertNotFinished(event);

  const player = await db.get('SELECT * FROM event_players WHERE id = ?', [req.params.playerId]);
  if (!player) throw new HttpError(404, 'Player not found', 'api.playerNotFound');

  const isOwner = event.owner_id === req.user.id;
  const isSelf = player.user_id === req.user.id;
  const { deck_name, status } = req.body;

  // Collaborative Deck Registering: any active participant may edit anyone's deck when enabled
  const isCollaborator = !isOwner && !isSelf && event.collaborative_deck
    ? await db.get(
        "SELECT id FROM event_players WHERE event_id = ? AND user_id = ? AND status = 'active'",
        [req.params.id, req.user.id]
      )
    : null;
  const canEditDeck = isOwner || isSelf || !!isCollaborator;
  const canEditStatus = isOwner; // only the owner can approve/reject/change a player's status

  if (deck_name !== undefined && !canEditDeck) throw new HttpError(403, 'Forbidden', 'api.forbidden');
  if (status !== undefined && !canEditStatus) throw new HttpError(403, 'Forbidden', 'api.forbidden');
  if (deck_name === undefined && status === undefined && !canEditDeck) throw new HttpError(403, 'Forbidden', 'api.forbidden');

  await db.run('UPDATE event_players SET deck_name=?, status=? WHERE id=?', [
    deck_name ?? player.deck_name,
    status ?? player.status,
    req.params.playerId,
  ]);
  if (status === 'active' && player.status === 'pending' && player.user_id) {
    await notifyUsers(db, [player.user_id], 'notif.joinApproved', { evento: event.name });
  }
  eventStream.broadcast(req.params.id);
  res.json(await db.get('SELECT * FROM event_players WHERE id = ?', [req.params.playerId]));
}));

// Auth: remove player (owner only) — kept as a drop once they've been paired
router.delete('/:id/players/:playerId', auth, asyncHandler(async (req, res) => {
  const event = await liveOwnedEvent(db, req.params.id, req.user.id);
  assertClanRosterOpen(event, 'remover jogador');

  const player = await db.get(
    'SELECT * FROM event_players WHERE id = ? AND event_id = ?',
    [req.params.playerId, req.params.id]
  );
  if (!player) throw new HttpError(404, 'Player not found', 'api.playerNotFound');

  const outcome = await retirePlayer(req.params.id, player);
  eventStream.broadcast(req.params.id);
  res.json({ message: outcome === 'dropped' ? 'Player dropped' : 'Player removed', dropped: outcome === 'dropped' });
}));

// Auth: finish event (owner only)
router.post('/:id/finish', auth, asyncHandler(async (req, res) => {
  const event = await ownedEvent(db, req.params.id, req.user.id);
  await db.run("UPDATE events SET status = 'completed' WHERE id = ?", [req.params.id]);
  await notifyUsers(db, await activeEventUserIds(db, req.params.id), 'notif.eventFinished', { evento: event.name });
  eventStream.broadcast(req.params.id);
  res.json(await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]));
}));

// Auth: start next round, or advance the playoff bracket if the current round is a playoff round (owner only)
router.post('/:id/rounds', auth, asyncHandler(async (req, res) => {
  const outcome = await db.transaction(async (tx) => {
    const event = await liveOwnedEvent(tx, req.params.id, req.user.id);

    let currentRoundRow = null;
    if (event.current_round > 0) {
      currentRoundRow = await tx.get(
        'SELECT * FROM rounds WHERE event_id = ? AND round_number = ?',
        [req.params.id, event.current_round]
      );
      if (currentRoundRow) {
        const pending = await pendingResultsCount(tx, currentRoundRow.id);
        if (pending > 0) {
          throw new HttpError(400, `Round ${event.current_round} ainda tem ${pending} resultado(s) pendente(s)`);
        }
      }
    }

    const podSize = event.pod_size || 2;
    const roundNumber = event.current_round + 1;

    if (currentRoundRow?.is_playoff && isTeamFormat(event)) {
      // Formato de time: cada mesa elimina um time inteiro. Quem avança é a dupla, não o jogador.
      const prevPairings = await tx.query(
        'SELECT * FROM pairings WHERE round_id = ? ORDER BY table_number',
        [currentRoundRow.id]
      );
      const allPlayers = await tx.query('SELECT * FROM event_players WHERE event_id = ?', [req.params.id]);
      const playersById = new Map(allPlayers.map((p) => [p.id, p]));

      const clansQueAvancam = [];
      for (const p of prevPairings) {
        const vencedor = clanOfResult(p, playersById);
        if (vencedor) clansQueAvancam.push(vencedor);
      }

      if (clansQueAvancam.length <= 1) {
        const clanCampeao = clansQueAvancam[0] ?? null;
        // champion_id guarda o melhor colocado do clã campeão, para as telas que
        // mostram um nome; champion_clan_id é quem de fato venceu.
        const pastPairings = await eventPairings(tx, req.params.id);
        const ranked = computeStandings(allPlayers, pastPairings, event);
        const melhorDoCla = ranked.find((p) => p.clan_id === clanCampeao) ?? null;
        await tx.run(
          "UPDATE events SET status = 'completed', champion_id = ?, champion_clan_id = ? WHERE id = ?",
          [melhorDoCla?.id ?? null, clanCampeao, req.params.id]
        );
        return {
          status: 200,
          body: { champion: true, event: await tx.get('SELECT * FROM events WHERE id = ?', [req.params.id]) },
        };
      }

      const pastPairings = await eventPairings(tx, req.params.id);
      const ranked = computeStandings(allPlayers, pastPairings, event);
      const { roundId } = await buildClanPlayoffRound(tx, event, clansQueAvancam, roundNumber, ranked, pastPairings);
      await tx.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?',
        [roundNumber, 'ongoing', req.params.id]);

      return {
        status: 201,
        body: {
          round: await tx.get('SELECT * FROM rounds WHERE id = ?', [roundId]),
          pairings: await tx.query('SELECT * FROM pairings WHERE round_id = ?', [roundId]),
        },
      };
    }

    if (currentRoundRow?.is_playoff) {
      // Advance the bracket: resolve who advances out of each pod of the current playoff round
      const prevPairings = await tx.query(
        'SELECT * FROM pairings WHERE round_id = ? ORDER BY table_number',
        [currentRoundRow.id]
      );
      const winnerKey = { player1: 'player1_id', player2: 'player2_id', player3: 'player3_id', player4: 'player4_id' };
      const advancers = [];
      for (const p of prevPairings) {
        if (p.result === 'bye' || p.result === 'draw') {
          // Bye: the lone player advances. Draw: the better-seeded slot (player1) advances as tiebreak.
          advancers.push(p.player1_id);
        } else if (winnerKey[p.result]) {
          advancers.push(p[winnerKey[p.result]]);
        }
      }

      if (advancers.length <= 1) {
        const championId = advancers[0] ?? null;
        await tx.run("UPDATE events SET status = 'completed', champion_id = ? WHERE id = ?", [championId, req.params.id]);
        return {
          status: 200,
          body: { champion: true, event: await tx.get('SELECT * FROM events WHERE id = ?', [req.params.id]) },
        };
      }

      const advancingPlayers = await tx.query(
        `SELECT * FROM event_players WHERE id IN (${advancers.map(() => '?').join(',')})`,
        advancers
      );
      const orderedAdvancers = advancers.map((id) => advancingPlayers.find((p) => p.id === id));

      const roundId = uuidv4();
      const stage = playoffStageLabel(orderedAdvancers.length, podSize);
      await tx.run(
        'INSERT INTO rounds (id, event_id, round_number, is_playoff, playoff_stage) VALUES (?, ?, ?, 1, ?)',
        [roundId, req.params.id, roundNumber, stage]
      );
      await insertPods(tx, req.params.id, roundId, seedPlayoffPods(orderedAdvancers, podSize));

      await tx.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?',
        [roundNumber, 'ongoing', req.params.id]);

      await notifyUsers(tx, await activeEventUserIds(tx, req.params.id), 'notif.playoffPaired', {
        evento: event.name,
        fase: stage,
      });

      return {
        status: 201,
        body: {
          round: await tx.get('SELECT * FROM rounds WHERE id = ?', [roundId]),
          pairings: await tx.query('SELECT * FROM pairings WHERE round_id = ?', [roundId]),
        },
      };
    }

    // Regular Swiss round
    const pastPairings = await eventPairings(tx, req.params.id);

    // O pareamento recebe os jogadores já com os desempates oficiais calculados:
    // é por essa classificação que o bye é decidido (o pior colocado que ainda não
    // recebeu um), independente do método de pareamento configurado no evento.
    // Dropados entram no cálculo como adversários enfrentados, mas não são pareados.
    const allPlayers = await tx.query('SELECT * FROM event_players WHERE event_id = ?', [req.params.id]);
    const players = computeStandings(allPlayers, pastPairings, event).filter((p) => p.status === 'active');
    if (players.length < 2) throw new HttpError(400, 'Need at least 2 active players', 'api.needTwoPlayers');

    let pods;
    if (isClanFormat(event)) {
      // Clã Fronto: mesas de 4 clãs distintos, sem bye. As guardas do formato
      // rodam antes, para o erro apontar o clã incompleto em vez de estourar
      // dentro do pareador.
      await assertTeamFieldReady(tx, event);
      pods = generateClanPairings(players, event.pairing_method, pastPairings, 200, roundNumber - 1);
    } else if (isPartnerFormat(event)) {
      // Partner: o suíço de sempre, com a dupla no lugar do jogador. A ordem das
      // duplas sai da classificação por time, que é onde a regra "3 pontos por
      // rodada, não 6" mora — parear pela soma dos parceiros ordenaria errado.
      await assertTeamFieldReady(tx, event);
      const clans = await eventClans(tx, req.params.id);
      const times = computeClanStandings(players, clans, pastPairings, event)
        .map((t) => ({ ...t, players: t.players.filter((p) => p.status === 'active') }))
        .filter((t) => t.players.length === 2);
      pods = generatePartnerPairings(times, event.pairing_method, pastPairings);
    } else {
      pods = generateSwissPairings(players, podSize, event.pairing_method, pastPairings);

      if (!event.allow_byes && pods.some((p) => !p.player2)) {
        throw new HttpError(400, 'Número de jogadores não forma pods completos e Byes estão desativados para este evento.');
      }
    }

    const roundId = uuidv4();
    await tx.run('INSERT INTO rounds (id, event_id, round_number) VALUES (?, ?, ?)',
      [roundId, req.params.id, roundNumber]);
    await insertPods(tx, req.params.id, roundId, pods);

    await tx.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?',
      [roundNumber, 'ongoing', req.params.id]);

    await notifyUsers(tx, await activeEventUserIds(tx, req.params.id), 'notif.roundStarted', {
      evento: event.name,
      rodada: roundNumber,
    });

    return {
      status: 201,
      body: {
        round: await tx.get('SELECT * FROM rounds WHERE id = ?', [roundId]),
        pairings: await tx.query('SELECT * FROM pairings WHERE round_id = ?', [roundId]),
      },
    };
  });

  eventStream.broadcast(req.params.id);
  res.status(outcome.status).json(outcome.body);
}));

// Auth: start the playoff bracket (owner only) — seeds top N players by standings into a single-elimination round
router.post('/:id/playoffs/start', auth, asyncHandler(async (req, res) => {
  const body = await db.transaction(async (tx) => {
    const event = await liveOwnedEvent(tx, req.params.id, req.user.id);
    if (!event.playoff_structure || event.playoff_structure === 'none')
      throw new HttpError(400, 'This event has no playoff structure configured');

    const existingPlayoffRound = await tx.get(
      'SELECT id FROM rounds WHERE event_id = ? AND is_playoff = 1 LIMIT 1',
      [req.params.id]
    );
    if (existingPlayoffRound) throw new HttpError(400, 'Playoffs already started');

    if (event.current_round > 0) {
      const currentRoundRow = await tx.get(
        'SELECT id FROM rounds WHERE event_id = ? AND round_number = ?',
        [req.params.id, event.current_round]
      );
      if (currentRoundRow) {
        const pending = await pendingResultsCount(tx, currentRoundRow.id);
        if (pending > 0) {
          throw new HttpError(400, `Round ${event.current_round} ainda tem ${pending} resultado(s) pendente(s)`);
        }
      }
    }

    // Os formatos de time têm chaveamento próprio: os melhores times, dois
    // jogadores cada, jogando em duplas. Cada mesa elimina um time inteiro, então
    // o bracket só divide por dois.
    //
    // No partner isto é quase de graça: a mesa do mata-mata é a mesma da rodada
    // normal, já 2v2. No Clã Fronto ela é a única em que companheiros sentam
    // juntos, e é de lá que a mesa de duplas veio.
    if (isTeamFormat(event)) {
      const totalClans = PLAYOFF_TEAM_COUNTS[event.playoff_structure];
      if (!totalClans) {
        throw new HttpError(400, `Este formato exige playoff de ${teamNounPlural(event)}`);
      }
      const allPlayers = await tx.query('SELECT * FROM event_players WHERE event_id = ?', [req.params.id]);
      const pastPairings = await eventPairings(tx, req.params.id);
      const ranked = computeStandings(allPlayers, pastPairings, event);
      const clans = await eventClans(tx, req.params.id);
      if (clans.length < totalClans) {
        throw new HttpError(400, `O torneio tem ${clans.length} ${teamNounPlural(event)}; o playoff escolhido precisa de ${totalClans}`);
      }
      const classificados = computeClanStandings(ranked, clans, pastPairings, event)
        .slice(0, totalClans).map((c) => c.id);

      const roundNumber = event.current_round + 1;
      const { roundId, seeded } = await buildClanPlayoffRound(tx, event, classificados, roundNumber, ranked, pastPairings);
      await tx.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?',
        [roundNumber, 'ongoing', req.params.id]);

      await notifyUsers(
        tx,
        seeded.flatMap((c) => c.players.map((p) => p.user_id)),
        'notif.clanQualified',
        { evento: event.name }
      );

      return {
        round: await tx.get('SELECT * FROM rounds WHERE id = ?', [roundId]),
        pairings: await tx.query('SELECT * FROM pairings WHERE round_id = ?', [roundId]),
      };
    }

    const PLAYOFF_SIZES = { top4: 4, top8: 8, top16: 16 };
    const N = PLAYOFF_SIZES[event.playoff_structure];
    // Um valor desconhecido aqui é bug de configuração, não um caso a adivinhar:
    // o `?? 8` que existia aqui iniciava um Top 8 silencioso em evento com playoff de clã.
    if (!N) throw new HttpError(400, `Estrutura de playoff inválida para este formato: "${event.playoff_structure}"`);
    // Seeding pela mesma ordem oficial exibida nas standings (pontos, OMW%, GW%,
    // OGW%) — antes eram só pontos e vitórias, o que podia premiar um chaveamento
    // diferente do que a tabela mostrava.
    const allPlayers = await tx.query('SELECT * FROM event_players WHERE event_id = ?', [req.params.id]);
    const ranked = computeStandings(allPlayers, await eventPairings(tx, req.params.id), event);
    const standings = ranked.filter((p) => p.status === 'active');
    const seeds = standings.slice(0, Math.min(N, standings.length));
    if (seeds.length < 2) throw new HttpError(400, 'Not enough active players for playoffs');

    const podSize = event.pod_size || 2;
    const roundNumber = event.current_round + 1;
    const roundId = uuidv4();
    const stage = playoffStageLabel(seeds.length, podSize);
    await tx.run(
      'INSERT INTO rounds (id, event_id, round_number, is_playoff, playoff_stage) VALUES (?, ?, ?, 1, ?)',
      [roundId, req.params.id, roundNumber, stage]
    );
    await insertPods(tx, req.params.id, roundId, seedPlayoffPods(seeds, podSize));

    await tx.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?',
      [roundNumber, 'ongoing', req.params.id]);

    await notifyUsers(tx, seeds.map((p) => p.user_id), 'notif.qualified', {
      evento: event.name,
      fase: stage,
    });

    return {
      round: await tx.get('SELECT * FROM rounds WHERE id = ?', [roundId]),
      pairings: await tx.query('SELECT * FROM pairings WHERE round_id = ?', [roundId]),
    };
  });

  eventStream.broadcast(req.params.id);
  res.status(201).json(body);
}));

/**
 * Solta o cronômetro da rodada (dono).
 *
 * Criar a rodada e começar a contar são dois momentos distintos: entre um e outro
 * está o tempo em que os jogadores acham a mesa e sentam. Antes isso saía do tempo
 * de jogo, porque o relógio nascia junto com o pareamento.
 */
router.post('/:id/rounds/:roundId/timer', auth, asyncHandler(async (req, res) => {
  const round = await db.transaction(async (tx) => {
    const event = await liveOwnedEvent(tx, req.params.id, req.user.id);

    const round = await tx.get(
      'SELECT * FROM rounds WHERE id = ? AND event_id = ?',
      [req.params.roundId, req.params.id]
    );
    if (!round) throw new HttpError(404, 'Rodada não encontrada', 'api.roundNotFound');
    if (round.timer_started_at) throw new HttpError(400, 'O cronômetro desta rodada já está correndo', 'api.timerAlreadyRunning');

    await tx.run('UPDATE rounds SET timer_started_at = NOW() WHERE id = ?', [req.params.roundId]);

    await notifyUsers(tx, await activeEventUserIds(tx, req.params.id), 'notif.timerStarted', {
      evento: event.name,
      fase: round.is_playoff ? round.playoff_stage : `${round.round_number}`,
      ehPlayoff: round.is_playoff ? 1 : 0,
    });

    return await tx.get('SELECT * FROM rounds WHERE id = ?', [req.params.roundId]);
  });

  eventStream.broadcast(req.params.id);
  res.json(round);
}));

// Auth: undo the latest round (owner only) — removes its pairings/results and reopens it for re-pairing
router.post('/:id/rounds/undo', auth, asyncHandler(async (req, res) => {
  const updated = await db.transaction(async (tx) => {
    const event = await ownedEvent(tx, req.params.id, req.user.id);
    if (event.current_round <= 0) throw new HttpError(400, 'No round to undo', 'api.noRoundToUndo');

    const round = await tx.get(
      'SELECT * FROM rounds WHERE event_id = ? AND round_number = ?',
      [req.params.id, event.current_round]
    );
    if (!round) throw new HttpError(404, 'Round not found', 'api.roundNotFound');

    // Não há retrospecto a devolver: cartel e pontos são derivados das mesas
    // confirmadas, então apagar as mesas já desfaz tudo o que elas produziram.
    // Antes daqui saía um laço que revertia vitória por vitória — e era ele que
    // precisava lembrar sozinho da regra das duplas do Clã Fronto.
    await tx.run('DELETE FROM pairings WHERE round_id = ?', [round.id]);
    await tx.run('DELETE FROM rounds WHERE id = ?', [round.id]);

    const newRoundNumber = event.current_round - 1;
    // champion_id junto: desfazer a final reabre o evento, e um campeão gravado
    // deixaria o banner pendurado num torneio que voltou a estar em disputa.
    await tx.run('UPDATE events SET current_round = ?, status = ?, champion_id = NULL, champion_clan_id = NULL WHERE id = ?', [
      newRoundNumber,
      newRoundNumber === 0 ? 'upcoming' : 'ongoing',
      req.params.id,
    ]);

    return await tx.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
  });

  eventStream.broadcast(req.params.id);
  res.json(updated);
}));

// Auth: swap two players' seats within the current round (owner only) — both matches must still be pending
router.post('/:id/rounds/swap', auth, validate(schemas.swapPlayers), asyncHandler(async (req, res) => {
  await db.transaction(async (tx) => {
    const event = await liveOwnedEvent(tx, req.params.id, req.user.id);
    if (event.current_round <= 0) throw new HttpError(400, 'No active round');

    const { player1Id, player2Id } = req.body;
    if (player1Id === player2Id) throw new HttpError(400, 'Two different players are required');

    const round = await tx.get(
      'SELECT * FROM rounds WHERE event_id = ? AND round_number = ?',
      [req.params.id, event.current_round]
    );
    if (!round) throw new HttpError(404, 'Round not found', 'api.roundNotFound');

    const pairings = await tx.query('SELECT * FROM pairings WHERE round_id = ? FOR UPDATE', [round.id]);
    const seatCols = ['player1_id', 'player2_id', 'player3_id', 'player4_id'];
    const locate = (playerId) => {
      for (const p of pairings) {
        for (const col of seatCols) {
          if (p[col] === playerId) return { pairing: p, col };
        }
      }
      return null;
    };

    const loc1 = locate(player1Id);
    const loc2 = locate(player2Id);
    if (!loc1 || !loc2) throw new HttpError(404, 'Player not found in current round');
    if (loc1.pairing.result || loc2.pairing.result)
      throw new HttpError(400, 'Cannot swap players whose match already has a result');

    if (loc1.pairing.id === loc2.pairing.id) {
      await tx.run(
        `UPDATE pairings SET ${loc1.col} = ?, ${loc2.col} = ? WHERE id = ?`,
        [player2Id, player1Id, loc1.pairing.id]
      );
    } else {
      await tx.run(`UPDATE pairings SET ${loc1.col} = ? WHERE id = ?`, [player2Id, loc1.pairing.id]);
      await tx.run(`UPDATE pairings SET ${loc2.col} = ? WHERE id = ?`, [player1Id, loc2.pairing.id]);
    }
  });

  eventStream.broadcast(req.params.id);
  res.json({ message: 'Players swapped' });
}));

// Auth: submit result (owner, or a seated player when Player-Reported Results is on)
// result: 'player1'|'player2'|'player3'|'player4' = that player won; 'draw' = all draw; 'bye' = auto win
router.put('/:id/pairings/:pairingId', auth, validate(schemas.submitResult), asyncHandler(async (req, res) => {
  const updated = await db.transaction(async (tx) => {
    const event = await tx.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) throw new HttpError(404, 'Event not found', 'api.eventNotFound');
    assertNotFinished(event);

    // Locked for the duration: recording a result reads the previous one, reverses
    // its points and applies the new ones. Two organizers submitting the same table
    // concurrently would otherwise both revert from the same starting state.
    const pairing = await tx.get('SELECT * FROM pairings WHERE id = ? FOR UPDATE', [req.params.pairingId]);
    if (!pairing) throw new HttpError(404, 'Pairing not found', 'api.pairingNotFound');

    const { result, p1_games, p2_games } = req.body;

    // Placar por games: só faz sentido numa mesa 1v1, e só o organizador registra.
    // Ele nunca decide quem venceu (isso é `result`) — alimenta GW% e OGW%.
    const isDuel = !!pairing.player2_id && !pairing.player3_id && !pairing.player4_id;
    const hasGameScore = p1_games !== undefined && p2_games !== undefined;
    if (hasGameScore && !isDuel) {
      throw new HttpError(400, 'Game scores only apply to 1v1 tables');
    }
    if (hasGameScore && result !== 'draw' && p1_games === p2_games) {
      throw new HttpError(400, 'A decided match cannot end on an even game score');
    }

    const isOwner = event.owner_id === req.user.id;
    if (!isOwner) {
      // Player-Reported Results: a seated player may self-report the outcome of their own
      // still-pending match. In a 1v1 they can report a win, a loss, or a draw. In a
      // multiplayer pod only "I Won" (unambiguous: everyone else lost) or "Draw" are allowed —
      // reporting a loss wouldn't say who among the other seats actually won.
      const seatedPlayer = await tx.get(
        'SELECT id FROM event_players WHERE event_id = ? AND user_id = ? AND id IN (?, ?, ?, ?)',
        [req.params.id, req.user.id, pairing.player1_id, pairing.player2_id, pairing.player3_id, pairing.player4_id]
      );
      const slotOf = { player1: pairing.player1_id, player2: pairing.player2_id, player3: pairing.player3_id, player4: pairing.player4_id };
      const mySlot = seatedPlayer && Object.keys(slotOf).find((slot) => slotOf[slot] === seatedPlayer.id);
      const isPod = !!(pairing.player3_id || pairing.player4_id);
      const allowedResults = mySlot
        ? (isPod ? ['draw', mySlot] : ['draw', mySlot, mySlot === 'player1' ? 'player2' : 'player1'])
        : [];

      const canSelfReport = event.async_draws && !pairing.result && allowedResults.includes(result);
      if (!canSelfReport) throw new HttpError(403, 'Forbidden', 'api.forbidden');
    }

    // Organizer-set results are confirmed immediately (they're the authority). A player's own
    // self-report needs the organizer's approval before it counts towards standings.
    const newStatus = isOwner ? 'confirmed' : 'pending';

    // Corrigir um resultado é só gravar o novo. Enquanto o retrospecto era uma
    // coluna somada a cada lançamento, trocar o vencedor exigia desfazer o
    // resultado anterior antes de aplicar o novo, sob pena de contar duas vezes —
    // e esse desfazer precisava conhecer sozinho a regra das duplas do Clã
    // Fronto. Derivado das mesas, o estado anterior simplesmente deixa de existir
    // quando a linha muda.
    //
    // Trocar o resultado sem informar placar zera o placar anterior: manter um
    // 2×1 antigo sob um vencedor novo produziria um GW% que nunca aconteceu.
    await tx.run(
      'UPDATE pairings SET result = ?, result_status = ?, p1_games = ?, p2_games = ? WHERE id = ?',
      [result, newStatus, hasGameScore ? p1_games : null, hasGameScore ? p2_games : null, req.params.pairingId]
    );

    const pending = await pendingResultsCount(tx, pairing.round_id);
    await tx.run('UPDATE rounds SET status = ? WHERE id = ?',
      [pending === 0 ? 'completed' : 'active', pairing.round_id]);

    // Quem reportou já sabe o que reportou: o aviso é para o organizador, quando
    // tem algo esperando aprovação dele.
    if (newStatus === 'pending') {
      await notifyUsers(tx, [event.owner_id], 'notif.resultPending', { evento: event.name });
    } else {
      await notifyUsers(tx, await pairingUserIds(tx, pairing), 'notif.resultRecorded', { evento: event.name });
    }

    return await tx.get('SELECT * FROM pairings WHERE id = ?', [req.params.pairingId]);
  });

  eventStream.broadcast(req.params.id);
  res.json(updated);
}));

// Auth: approve a player-submitted result (owner only) — applies its already-stored points
router.post('/:id/pairings/:pairingId/approve', auth, asyncHandler(async (req, res) => {
  const updated = await db.transaction(async (tx) => {
    const event = await liveOwnedEvent(tx, req.params.id, req.user.id);

    const pairing = await tx.get('SELECT * FROM pairings WHERE id = ? FOR UPDATE', [req.params.pairingId]);
    if (!pairing) throw new HttpError(404, 'Pairing not found', 'api.pairingNotFound');
    if (!pairing.result) throw new HttpError(400, 'No result to approve');
    if (pairing.result_status === 'confirmed') throw new HttpError(400, 'Result already confirmed');

    // Aprovar é mudar o status da mesa. Um resultado pendente já estava gravado e
    // apenas não contava; confirmá-lo o coloca no cálculo, sem nenhuma escrita de
    // retrospecto — que é derivado das mesas confirmadas.
    await tx.run("UPDATE pairings SET result_status = 'confirmed' WHERE id = ?", [req.params.pairingId]);

    const pending = await pendingResultsCount(tx, pairing.round_id);
    await tx.run('UPDATE rounds SET status = ? WHERE id = ?',
      [pending === 0 ? 'completed' : 'active', pairing.round_id]);

    await notifyUsers(tx, await pairingUserIds(tx, pairing), 'notif.resultApproved', { evento: event.name });

    return await tx.get('SELECT * FROM pairings WHERE id = ?', [req.params.pairingId]);
  });

  eventStream.broadcast(req.params.id);
  res.json(updated);
}));

module.exports = router;
