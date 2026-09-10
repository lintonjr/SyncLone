const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const auth = require('../middleware/auth');
const requireOrganizer = require('../middleware/requireOrganizer');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { HttpError, asyncHandler } = require('../lib/http');
const { generateSwissPairings, seedPlayoffPods } = require('../services/pairing');
const { computeStandings } = require('../services/standings');
const { notifyUsers, activeEventUserIds, pairingUserIds } = require('../services/notify');
const eventStream = require('../services/eventStream');

// Uploaded covers are served from the same origin as the SPA, so the stored file
// must never be something a browser will execute. The extension comes from the
// mimetype we accepted, never from the client's filename — otherwise a file named
// "x.html" lands on disk as .html and express.static serves it as a document.
const IMAGE_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (_, file, cb) => cb(null, `${uuidv4()}${IMAGE_EXTENSIONS[file.mimetype]}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (IMAGE_EXTENSIONS[file.mimetype]) return cb(null, true);
    cb(new HttpError(400, 'Cover image must be a PNG, JPEG, WebP or GIF'));
  },
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
async function insertPods(conn, eventId, roundId, pods, pointsWin) {
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
    if (isBye && pod.player1) {
      await conn.run('UPDATE event_players SET wins=wins+1, points=points+? WHERE id=?', [pointsWin, pod.player1.id]);
    }
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
  if (!event) throw new HttpError(404, 'Event not found');
  if (event.owner_id !== userId) throw new HttpError(403, 'Forbidden');
  return event;
}

// A finished event is a closed record: nothing may be added to it or altered in
// it. The one way back is Undo, which is deliberately exempt — it's the recovery
// path when a bracket was resolved by mistake.
function assertNotFinished(event) {
  if (event.status === 'completed') {
    throw new HttpError(400, 'This event has already finished');
  }
}

// Convenience for the many owner-only routes that also require a live event.
async function liveOwnedEvent(conn, eventId, userId) {
  const event = await ownedEvent(conn, eventId, userId);
  assertNotFinished(event);
  return event;
}

// Every pairing of an event, for the standings/tiebreaker calculation.
const eventPairings = (conn, eventId) =>
  conn.query('SELECT * FROM pairings WHERE event_id = ?', [eventId]);

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
  if (!event) throw new HttpError(404, 'Event not found');

  // LEFT JOIN so guest players (user_id = NULL) also appear
  const players = await db.query(
    `SELECT ep.*, COALESCE(u.display_name, ep.display_name) AS display_name
     FROM event_players ep LEFT JOIN users u ON u.id = ep.user_id
     WHERE ep.event_id = ? ORDER BY ep.points DESC, ep.wins DESC`,
    [req.params.id]
  );

  const rounds = await db.query(
    'SELECT * FROM rounds WHERE event_id = ? ORDER BY round_number',
    [req.params.id]
  );
  const pairings = rounds.length
    ? await db.query(
        `SELECT p.*,
           ep1.display_name as p1_name,
           ep2.display_name as p2_name,
           ep3.display_name as p3_name,
           ep4.display_name as p4_name
         FROM pairings p
         LEFT JOIN event_players ep1 ON ep1.id = p.player1_id
         LEFT JOIN event_players ep2 ON ep2.id = p.player2_id
         LEFT JOIN event_players ep3 ON ep3.id = p.player3_id
         LEFT JOIN event_players ep4 ON ep4.id = p.player4_id
         WHERE p.event_id = ? ORDER BY p.table_number`,
        [req.params.id]
      )
    : [];

  // Standings e desempates saem prontos do servidor: a mesma ordem alimenta a
  // tabela, o seeding dos playoffs e a exportação, sem cada cliente recalcular
  // (e divergir) por conta própria.
  res.json({ ...event, players: computeStandings(players, pairings, event), rounds, pairings });
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

router.get('/:id/export', asyncHandler(async (req, res) => {
  const type = req.query.type === 'pairings' ? 'pairings' : 'standings';

  const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
  if (!event) throw new HttpError(404, 'Event not found');

  const players = await db.query(
    `SELECT ep.*, COALESCE(u.display_name, ep.display_name) AS display_name
     FROM event_players ep LEFT JOIN users u ON u.id = ep.user_id WHERE ep.event_id = ?`,
    [req.params.id]
  );
  const pairings = await eventPairings(db, req.params.id);
  const ranked = computeStandings(players, pairings, event);

  let rows;
  if (type === 'standings') {
    rows = [['Rank', 'Player', 'Deck', 'Status', 'W', 'L', 'D', 'Points', 'Matches', 'MW%', 'OMW%', 'GW%', 'OGW%']];
    ranked.filter((p) => p.status === 'active').forEach((p, i) => {
      rows.push([i + 1, p.display_name, p.deck_name ?? '', p.status, p.wins, p.losses, p.draws,
        p.points, p.matches_played, pct(p.mwp), pct(p.omw), pct(p.gwp), pct(p.ogw)]);
    });
    // Dropados vão no fim, sem posição: saíram da disputa mas fizeram parte dela.
    ranked.filter((p) => p.status === 'dropped').forEach((p) => {
      rows.push(['', p.display_name, p.deck_name ?? '', p.status, p.wins, p.losses, p.draws,
        p.points, p.matches_played, pct(p.mwp), pct(p.omw), pct(p.gwp), pct(p.ogw)]);
    });
  } else {
    const rounds = await db.query('SELECT * FROM rounds WHERE event_id = ? ORDER BY round_number', [req.params.id]);
    const roundOf = new Map(rounds.map((r) => [r.id, r]));
    const nameOf = new Map(players.map((p) => [p.id, p.display_name]));
    const winnerSeat = { player1: 1, player2: 2, player3: 3, player4: 4 };

    rows = [['Round', 'Stage', 'Table', 'Player 1', 'Player 2', 'Player 3', 'Player 4', 'Result', 'Winner', 'Games', 'Status']];
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
        ...seats.map((id) => (id ? nameOf.get(id) ?? '' : '')),
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
    name, description, city, address, online, date, game, format,
    pairing_method, playoff_structure, allow_byes, test_event,
    collaborative_deck, async_draws, confirm_players, qr_code_enabled, league_id, pod_size,
    points_win, points_draw, points_loss,
  } = req.body;

  let leagueIdVal = null;
  if (league_id) {
    const league = await db.get('SELECT * FROM leagues WHERE id = ?', [league_id]);
    if (!league) throw new HttpError(404, 'League not found');
    if (league.owner_id !== req.user.id) throw new HttpError(403, 'You can only attach events to your own leagues');
    leagueIdVal = league_id;
  }

  const id = uuidv4();
  const thumbnail = req.file ? `/uploads/${req.file.filename}` : null;
  const podSizeVal = parseInt(pod_size) || 2;
  const pointsWinVal = points_win !== undefined && points_win !== '' ? parseInt(points_win) : 3;
  const pointsDrawVal = points_draw !== undefined && points_draw !== '' ? parseInt(points_draw) : 1;
  const pointsLossVal = points_loss !== undefined && points_loss !== '' ? parseInt(points_loss) : 0;

  await db.run(`
    INSERT INTO events (id, name, description, city, address, online, thumbnail, date, game, format,
      pairing_method, playoff_structure, allow_byes, test_event, collaborative_deck, async_draws,
      confirm_players, qr_code_enabled, league_id, pod_size, points_win, points_draw, points_loss, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, name, description || null, city || null, address || null,
    parseBool(online) ? 1 : 0, thumbnail, date, game, format || null,
    pairing_method || 'swiss', playoff_structure || 'none',
    parseBool(allow_byes) ? 1 : 0, parseBool(test_event) ? 1 : 0,
    parseBool(collaborative_deck) ? 1 : 0, parseBool(async_draws) ? 1 : 0,
    parseBool(confirm_players) ? 1 : 0, parseBool(qr_code_enabled) ? 1 : 0, leagueIdVal, podSizeVal,
    pointsWinVal, pointsDrawVal, pointsLossVal, req.user.id,
  ]);

  res.status(201).json(await db.get('SELECT * FROM events WHERE id = ?', [id]));
}));

// Auth: update event (owner only)
router.put('/:id', auth, upload.single('thumbnail'), validate(schemas.updateEvent), asyncHandler(async (req, res) => {
  const event = await ownedEvent(db, req.params.id, req.user.id);

  const {
    name, description, city, address, online, date, game, format,
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
      if (!league) throw new HttpError(404, 'League not found');
      if (league.owner_id !== req.user.id) throw new HttpError(403, 'You can only attach events to your own leagues');
      leagueIdVal = league_id;
    }
  }

  const thumbnail = req.file ? `/uploads/${req.file.filename}` : event.thumbnail;

  await db.run(`
    UPDATE events SET name=?, description=?, city=?, address=?, online=?, thumbnail=?, date=?,
    game=?, format=?, pairing_method=?, pod_size=?, playoff_structure=?, allow_byes=?, test_event=?,
    collaborative_deck=?, async_draws=?, confirm_players=?, qr_code_enabled=?, league_id=?, points_win=?, points_draw=?, points_loss=?,
    status=? WHERE id=?
  `, [
    name || event.name, description ?? event.description, city ?? event.city,
    address ?? event.address, online !== undefined ? (parseBool(online) ? 1 : 0) : event.online,
    thumbnail, date || event.date, game || event.game, format ?? event.format,
    pairing_method || event.pairing_method, pod_size ? parseInt(pod_size) : event.pod_size,
    playoff_structure || event.playoff_structure,
    allow_byes !== undefined ? (parseBool(allow_byes) ? 1 : 0) : event.allow_byes,
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

  res.json(await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]));
}));

// Auth: delete event (owner only)
router.delete('/:id', auth, asyncHandler(async (req, res) => {
  await db.transaction(async (tx) => {
    await ownedEvent(tx, req.params.id, req.user.id);
    await tx.run('DELETE FROM pairings WHERE event_id = ?', [req.params.id]);
    await tx.run('DELETE FROM rounds WHERE event_id = ?', [req.params.id]);
    await tx.run('DELETE FROM event_players WHERE event_id = ?', [req.params.id]);
    await tx.run('DELETE FROM events WHERE id = ?', [req.params.id]);
  });
  res.json({ message: 'Event deleted' });
}));

// Auth: join event
router.post('/:id/join', auth, asyncHandler(async (req, res) => {
  const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
  if (!event) throw new HttpError(404, 'Event not found');
  if (event.status === 'completed') throw new HttpError(400, 'This event has already finished');
  const existing = await db.get(
    'SELECT id FROM event_players WHERE event_id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );
  if (existing) throw new HttpError(409, 'Already joined');

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
  if (!event) throw new HttpError(404, 'Event not found');
  assertNotFinished(event);

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
  if (userId) await notifyUsers(db, [userId], `Você foi inscrito em ${event.name}.`);
  eventStream.broadcast(req.params.id);
  res.status(201).json(await db.get('SELECT * FROM event_players WHERE id = ?', [id]));
}));

// Auth: update player deck/status
router.put('/:id/players/:playerId', auth, validate(schemas.updatePlayer), asyncHandler(async (req, res) => {
  const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
  if (!event) throw new HttpError(404, 'Event not found');
  assertNotFinished(event);

  const player = await db.get('SELECT * FROM event_players WHERE id = ?', [req.params.playerId]);
  if (!player) throw new HttpError(404, 'Player not found');

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

  if (deck_name !== undefined && !canEditDeck) throw new HttpError(403, 'Forbidden');
  if (status !== undefined && !canEditStatus) throw new HttpError(403, 'Forbidden');
  if (deck_name === undefined && status === undefined && !canEditDeck) throw new HttpError(403, 'Forbidden');

  await db.run('UPDATE event_players SET deck_name=?, status=? WHERE id=?', [
    deck_name ?? player.deck_name,
    status ?? player.status,
    req.params.playerId,
  ]);
  if (status === 'active' && player.status === 'pending' && player.user_id) {
    await notifyUsers(db, [player.user_id], `Sua inscrição em ${event.name} foi aprovada.`);
  }
  eventStream.broadcast(req.params.id);
  res.json(await db.get('SELECT * FROM event_players WHERE id = ?', [req.params.playerId]));
}));

// Auth: remove player (owner only) — kept as a drop once they've been paired
router.delete('/:id/players/:playerId', auth, asyncHandler(async (req, res) => {
  await liveOwnedEvent(db, req.params.id, req.user.id);

  const player = await db.get(
    'SELECT * FROM event_players WHERE id = ? AND event_id = ?',
    [req.params.playerId, req.params.id]
  );
  if (!player) throw new HttpError(404, 'Player not found');

  const outcome = await retirePlayer(req.params.id, player);
  eventStream.broadcast(req.params.id);
  res.json({ message: outcome === 'dropped' ? 'Player dropped' : 'Player removed', dropped: outcome === 'dropped' });
}));

// Auth: finish event (owner only)
router.post('/:id/finish', auth, asyncHandler(async (req, res) => {
  const event = await ownedEvent(db, req.params.id, req.user.id);
  await db.run("UPDATE events SET status = 'completed' WHERE id = ?", [req.params.id]);
  await notifyUsers(db, await activeEventUserIds(db, req.params.id), `${event.name} foi finalizado — confira a classificação final.`);
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
      await insertPods(tx, req.params.id, roundId, seedPlayoffPods(orderedAdvancers, podSize), event.points_win);

      await tx.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?',
        [roundNumber, 'ongoing', req.params.id]);

      await notifyUsers(
        tx,
        await activeEventUserIds(tx, req.params.id),
        `${event.name}: ${stage} — os pareamentos já estão no ar.`
      );

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
    if (players.length < 2) throw new HttpError(400, 'Need at least 2 active players');

    const pods = generateSwissPairings(players, podSize, event.pairing_method, pastPairings);

    if (!event.allow_byes && pods.some((p) => !p.player2)) {
      throw new HttpError(400, 'Número de jogadores não forma pods completos e Byes estão desativados para este evento.');
    }

    const roundId = uuidv4();
    await tx.run('INSERT INTO rounds (id, event_id, round_number) VALUES (?, ?, ?)',
      [roundId, req.params.id, roundNumber]);
    await insertPods(tx, req.params.id, roundId, pods, event.points_win);

    await tx.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?',
      [roundNumber, 'ongoing', req.params.id]);

    await notifyUsers(
      tx,
      await activeEventUserIds(tx, req.params.id),
      `${event.name}: a Rodada ${roundNumber} começou — confira seu pareamento.`
    );

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

    const PLAYOFF_SIZES = { top4: 4, top8: 8, top16: 16 };
    const N = PLAYOFF_SIZES[event.playoff_structure] ?? 8;
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
    await insertPods(tx, req.params.id, roundId, seedPlayoffPods(seeds, podSize), event.points_win);

    await tx.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?',
      [roundNumber, 'ongoing', req.params.id]);

    await notifyUsers(
      tx,
      seeds.map((p) => p.user_id),
      `${event.name}: você se classificou para os playoffs (${stage}).`
    );

    return {
      round: await tx.get('SELECT * FROM rounds WHERE id = ?', [roundId]),
      pairings: await tx.query('SELECT * FROM pairings WHERE round_id = ?', [roundId]),
    };
  });

  eventStream.broadcast(req.params.id);
  res.status(201).json(body);
}));

// Auth: undo the latest round (owner only) — removes its pairings/results and reopens it for re-pairing
router.post('/:id/rounds/undo', auth, asyncHandler(async (req, res) => {
  const updated = await db.transaction(async (tx) => {
    const event = await ownedEvent(tx, req.params.id, req.user.id);
    if (event.current_round <= 0) throw new HttpError(400, 'No round to undo');

    const round = await tx.get(
      'SELECT * FROM rounds WHERE event_id = ? AND round_number = ?',
      [req.params.id, event.current_round]
    );
    if (!round) throw new HttpError(404, 'Round not found');

    const undoWin  = async (id) => id && await tx.run('UPDATE event_players SET wins=wins-1,   points=points-? WHERE id=?', [event.points_win, id]);
    const undoLoss = async (id) => id && await tx.run('UPDATE event_players SET losses=losses-1, points=points-? WHERE id=?', [event.points_loss, id]);
    const undoDraw = async (id) => id && await tx.run('UPDATE event_players SET draws=draws-1,  points=points-? WHERE id=?', [event.points_draw, id]);
    const winnerKey = { player1: 'player1_id', player2: 'player2_id', player3: 'player3_id', player4: 'player4_id' };

    const pairings = await tx.query('SELECT * FROM pairings WHERE round_id = ?', [round.id]);
    for (const p of pairings) {
      if (!p.result || p.result_status !== 'confirmed') continue;
      const allPlayers = [p.player1_id, p.player2_id, p.player3_id, p.player4_id].filter(Boolean);
      if (p.result === 'draw') {
        for (const id of allPlayers) await undoDraw(id);
      } else if (p.result === 'bye') {
        for (const id of allPlayers) await undoWin(id);
      } else if (winnerKey[p.result]) {
        const winnerId = p[winnerKey[p.result]];
        for (const id of allPlayers) {
          if (id === winnerId) await undoWin(id);
          else await undoLoss(id);
        }
      }
    }

    await tx.run('DELETE FROM pairings WHERE round_id = ?', [round.id]);
    await tx.run('DELETE FROM rounds WHERE id = ?', [round.id]);

    const newRoundNumber = event.current_round - 1;
    // champion_id junto: desfazer a final reabre o evento, e um campeão gravado
    // deixaria o banner pendurado num torneio que voltou a estar em disputa.
    await tx.run('UPDATE events SET current_round = ?, status = ?, champion_id = NULL WHERE id = ?', [
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
    if (!round) throw new HttpError(404, 'Round not found');

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
    if (!event) throw new HttpError(404, 'Event not found');
    assertNotFinished(event);

    // Locked for the duration: recording a result reads the previous one, reverses
    // its points and applies the new ones. Two organizers submitting the same table
    // concurrently would otherwise both revert from the same starting state.
    const pairing = await tx.get('SELECT * FROM pairings WHERE id = ? FOR UPDATE', [req.params.pairingId]);
    if (!pairing) throw new HttpError(404, 'Pairing not found');

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
      if (!canSelfReport) throw new HttpError(403, 'Forbidden');
    }

    // Organizer-set results are confirmed immediately (they're the authority). A player's own
    // self-report needs the organizer's approval before it counts towards standings.
    const newStatus = isOwner ? 'confirmed' : 'pending';

    const win  = async (id) => id && await tx.run('UPDATE event_players SET wins=wins+1,   points=points+? WHERE id=?', [event.points_win, id]);
    const loss = async (id) => id && await tx.run('UPDATE event_players SET losses=losses+1, points=points+? WHERE id=?', [event.points_loss, id]);
    const draw = async (id) => id && await tx.run('UPDATE event_players SET draws=draws+1,  points=points+? WHERE id=?', [event.points_draw, id]);
    const undoWin  = async (id) => id && await tx.run('UPDATE event_players SET wins=wins-1,   points=points-? WHERE id=?', [event.points_win, id]);
    const undoLoss = async (id) => id && await tx.run('UPDATE event_players SET losses=losses-1, points=points-? WHERE id=?', [event.points_loss, id]);
    const undoDraw = async (id) => id && await tx.run('UPDATE event_players SET draws=draws-1,  points=points-? WHERE id=?', [event.points_draw, id]);

    // Collect all players in this pod (non-null)
    const allPlayers = [pairing.player1_id, pairing.player2_id, pairing.player3_id, pairing.player4_id].filter(Boolean);
    const winnerKey = { player1: pairing.player1_id, player2: pairing.player2_id, player3: pairing.player3_id, player4: pairing.player4_id };

    // Revert the previous result's effect, if any, before applying the new one
    // (prevents double-counting points when an owner corrects a result). A pending result never
    // had points applied, so there's nothing to revert in that case.
    if (pairing.result && pairing.result_status === 'confirmed') {
      if (pairing.result === 'draw') {
        for (const id of allPlayers) await undoDraw(id);
      } else if (pairing.result === 'bye') {
        for (const id of allPlayers) await undoWin(id);
      } else if (winnerKey[pairing.result] !== undefined) {
        const prevWinnerId = winnerKey[pairing.result];
        for (const id of allPlayers) {
          if (id === prevWinnerId) await undoWin(id);
          else await undoLoss(id);
        }
      }
    }

    // Trocar o resultado sem informar placar zera o placar anterior: manter um
    // 2×1 antigo sob um vencedor novo produziria um GW% que nunca aconteceu.
    await tx.run(
      'UPDATE pairings SET result = ?, result_status = ?, p1_games = ?, p2_games = ? WHERE id = ?',
      [result, newStatus, hasGameScore ? p1_games : null, hasGameScore ? p2_games : null, req.params.pairingId]
    );

    if (newStatus === 'confirmed') {
      if (result === 'draw') {
        for (const id of allPlayers) await draw(id);
      } else if (result === 'bye') {
        for (const id of allPlayers) await win(id);
      } else {
        const winnerId = winnerKey[result];
        for (const id of allPlayers) {
          if (id === winnerId) await win(id);
          else await loss(id);
        }
      }
    }

    const pending = await pendingResultsCount(tx, pairing.round_id);
    await tx.run('UPDATE rounds SET status = ? WHERE id = ?',
      [pending === 0 ? 'completed' : 'active', pairing.round_id]);

    // Quem reportou já sabe o que reportou: o aviso é para o organizador, quando
    // tem algo esperando aprovação dele.
    if (newStatus === 'pending') {
      await notifyUsers(tx, [event.owner_id], `${event.name}: um resultado foi reportado e aguarda sua aprovação.`);
    } else {
      await notifyUsers(tx, await pairingUserIds(tx, pairing), `${event.name}: o resultado da sua mesa foi registrado.`);
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
    if (!pairing) throw new HttpError(404, 'Pairing not found');
    if (!pairing.result) throw new HttpError(400, 'No result to approve');
    if (pairing.result_status === 'confirmed') throw new HttpError(400, 'Result already confirmed');

    const win  = async (id) => id && await tx.run('UPDATE event_players SET wins=wins+1,   points=points+? WHERE id=?', [event.points_win, id]);
    const loss = async (id) => id && await tx.run('UPDATE event_players SET losses=losses+1, points=points+? WHERE id=?', [event.points_loss, id]);
    const draw = async (id) => id && await tx.run('UPDATE event_players SET draws=draws+1,  points=points+? WHERE id=?', [event.points_draw, id]);

    const allPlayers = [pairing.player1_id, pairing.player2_id, pairing.player3_id, pairing.player4_id].filter(Boolean);
    const winnerKey = { player1: pairing.player1_id, player2: pairing.player2_id, player3: pairing.player3_id, player4: pairing.player4_id };

    if (pairing.result === 'draw') {
      for (const id of allPlayers) await draw(id);
    } else if (pairing.result === 'bye') {
      for (const id of allPlayers) await win(id);
    } else {
      const winnerId = winnerKey[pairing.result];
      for (const id of allPlayers) {
        if (id === winnerId) await win(id);
        else await loss(id);
      }
    }

    await tx.run("UPDATE pairings SET result_status = 'confirmed' WHERE id = ?", [req.params.pairingId]);

    const pending = await pendingResultsCount(tx, pairing.round_id);
    await tx.run('UPDATE rounds SET status = ? WHERE id = ?',
      [pending === 0 ? 'completed' : 'active', pairing.round_id]);

    await notifyUsers(tx, await pairingUserIds(tx, pairing), `${event.name}: o resultado da sua mesa foi aprovado.`);

    return await tx.get('SELECT * FROM pairings WHERE id = ?', [req.params.pairingId]);
  });

  eventStream.broadcast(req.params.id);
  res.json(updated);
}));

module.exports = router;
