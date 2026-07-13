const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const auth = require('../middleware/auth');
const requireOrganizer = require('../middleware/requireOrganizer');
const { generateSwissPairings, seedPlayoffPods } = require('../services/pairing');
const eventStream = require('../services/eventStream');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (_, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const parseBool = (v) => v === 'true' || v === true || v === 1 || v === '1';

async function pendingResultsCount(roundId) {
  const row = await db.get(
    "SELECT COUNT(*) as cnt FROM pairings WHERE round_id = ? AND (result IS NULL OR result_status = 'pending')",
    [roundId]
  );
  return row.cnt;
}

// Insert pairings for a set of pods and auto-award any bye wins
async function insertPods(eventId, roundId, pods, pointsWin) {
  for (let idx = 0; idx < pods.length; idx++) {
    const pod = pods[idx];
    const isBye = !pod.player2;
    await db.run(
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
      await db.run('UPDATE event_players SET wins=wins+1, points=points+? WHERE id=?', [pointsWin, pod.player1.id]);
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

// Auth: get my events (must be before /:id)
router.get('/user/mine', auth, async (req, res) => {
  try {
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Public: list events
router.get('/', async (req, res) => {
  try {
    const { q, past } = req.query;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    let sql = `SELECT e.*, u.display_name as owner_name,
      (SELECT COUNT(*) FROM event_players ep WHERE ep.event_id = e.id AND ep.status = 'active') as player_count
      FROM events e JOIN users u ON u.id = e.owner_id WHERE e.test_event = 0`;
    const params = [];
    if (past === 'true') { sql += " AND (e.date < ? OR e.status = 'completed')"; params.push(now); }
    else { sql += " AND e.date >= ? AND e.status != 'completed'"; params.push(now); }
    if (q) {
      sql += ' AND (e.name LIKE ? OR e.description LIKE ? OR e.game LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY e.date ASC';
    res.json(await db.query(sql, params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Public: get single event
router.get('/:id', async (req, res) => {
  try {
    const event = await db.get(
      'SELECT e.*, u.display_name as owner_name FROM events e JOIN users u ON u.id = e.owner_id WHERE e.id = ?',
      [req.params.id]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });

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

    res.json({ ...event, players, rounds, pairings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

// Auth: create event (organizer only)
router.post('/', auth, requireOrganizer, upload.single('thumbnail'), async (req, res) => {
  try {
    const {
      name, description, city, address, online, date, game, format,
      pairing_method, playoff_structure, allow_byes, test_event,
      collaborative_deck, async_draws, confirm_players, qr_code_enabled, pod_size,
      points_win, points_draw, points_loss,
    } = req.body;
    if (!name || !date || !game)
      return res.status(400).json({ error: 'Name, date and game are required' });

    const id = uuidv4();
    const thumbnail = req.file ? `/uploads/${req.file.filename}` : null;
    const podSizeVal = parseInt(pod_size) || 2;
    const pointsWinVal = points_win !== undefined && points_win !== '' ? parseInt(points_win) : 3;
    const pointsDrawVal = points_draw !== undefined && points_draw !== '' ? parseInt(points_draw) : 1;
    const pointsLossVal = points_loss !== undefined && points_loss !== '' ? parseInt(points_loss) : 0;

    await db.run(`
      INSERT INTO events (id, name, description, city, address, online, thumbnail, date, game, format,
        pairing_method, playoff_structure, allow_byes, test_event, collaborative_deck, async_draws,
        confirm_players, qr_code_enabled, pod_size, points_win, points_draw, points_loss, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, name, description || null, city || null, address || null,
      parseBool(online) ? 1 : 0, thumbnail, date, game, format || null,
      pairing_method || 'swiss', playoff_structure || 'none',
      parseBool(allow_byes) ? 1 : 0, parseBool(test_event) ? 1 : 0,
      parseBool(collaborative_deck) ? 1 : 0, parseBool(async_draws) ? 1 : 0,
      parseBool(confirm_players) ? 1 : 0, parseBool(qr_code_enabled) ? 1 : 0, podSizeVal,
      pointsWinVal, pointsDrawVal, pointsLossVal, req.user.id,
    ]);

    res.status(201).json(await db.get('SELECT * FROM events WHERE id = ?', [id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: update event (owner only)
router.put('/:id', auth, upload.single('thumbnail'), async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const {
      name, description, city, address, online, date, game, format,
      pairing_method, pod_size, playoff_structure, allow_byes, test_event,
      collaborative_deck, async_draws, confirm_players, qr_code_enabled, status,
      points_win, points_draw, points_loss,
    } = req.body;

    const thumbnail = req.file ? `/uploads/${req.file.filename}` : event.thumbnail;

    await db.run(`
      UPDATE events SET name=?, description=?, city=?, address=?, online=?, thumbnail=?, date=?,
      game=?, format=?, pairing_method=?, pod_size=?, playoff_structure=?, allow_byes=?, test_event=?,
      collaborative_deck=?, async_draws=?, confirm_players=?, qr_code_enabled=?, points_win=?, points_draw=?, points_loss=?,
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
      points_win !== undefined && points_win !== '' ? parseInt(points_win) : event.points_win,
      points_draw !== undefined && points_draw !== '' ? parseInt(points_draw) : event.points_draw,
      points_loss !== undefined && points_loss !== '' ? parseInt(points_loss) : event.points_loss,
      status || event.status, req.params.id,
    ]);

    res.json(await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: delete event (owner only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM pairings WHERE event_id = ?', [req.params.id]);
    await db.run('DELETE FROM rounds WHERE event_id = ?', [req.params.id]);
    await db.run('DELETE FROM event_players WHERE event_id = ?', [req.params.id]);
    await db.run('DELETE FROM events WHERE id = ?', [req.params.id]);
    res.json({ message: 'Event deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: join event
router.post('/:id/join', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.status === 'completed') return res.status(400).json({ error: 'This event has already finished' });
    const existing = await db.get(
      'SELECT id FROM event_players WHERE event_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (existing) return res.status(409).json({ error: 'Already joined' });

    const status = event.confirm_players ? 'pending' : 'active';
    await db.run(
      'INSERT INTO event_players (id, event_id, user_id, display_name, status) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), req.params.id, req.user.id, req.user.display_name, status]
    );
    eventStream.broadcast(req.params.id);
    res.status(201).json({ message: status === 'pending' ? 'Join request sent' : 'Joined event', pending: status === 'pending' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: leave event
router.delete('/:id/join', auth, async (req, res) => {
  try {
    await db.run('DELETE FROM event_players WHERE event_id = ? AND user_id = ?',
      [req.params.id, req.user.id]);
    eventStream.broadcast(req.params.id);
    res.json({ message: 'Left event' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: add player by email or guest name (owner only)
router.post('/:id/players', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { email, display_name } = req.body;
    let userId = null;
    let name = display_name || 'Guest';

    if (email) {
      const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
      if (!user) return res.status(404).json({ error: 'User not found with that email' });
      userId = user.id;
      name = user.display_name;
    }

    if (userId) {
      const existing = await db.get(
        'SELECT id FROM event_players WHERE event_id = ? AND user_id = ?',
        [req.params.id, userId]
      );
      if (existing) return res.status(409).json({ error: 'Player already in event' });
    }

    const id = uuidv4();
    await db.run(
      'INSERT INTO event_players (id, event_id, user_id, display_name) VALUES (?, ?, ?, ?)',
      [id, req.params.id, userId, name]
    );
    eventStream.broadcast(req.params.id);
    res.status(201).json(await db.get('SELECT * FROM event_players WHERE id = ?', [id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: update player deck/status
router.put('/:id/players/:playerId', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const player = await db.get('SELECT * FROM event_players WHERE id = ?', [req.params.playerId]);
    if (!player) return res.status(404).json({ error: 'Player not found' });

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

    if (deck_name !== undefined && !canEditDeck) return res.status(403).json({ error: 'Forbidden' });
    if (status !== undefined && !canEditStatus) return res.status(403).json({ error: 'Forbidden' });
    if (deck_name === undefined && status === undefined && !canEditDeck) return res.status(403).json({ error: 'Forbidden' });

    await db.run('UPDATE event_players SET deck_name=?, status=? WHERE id=?', [
      deck_name ?? player.deck_name,
      status ?? player.status,
      req.params.playerId,
    ]);
    eventStream.broadcast(req.params.id);
    res.json(await db.get('SELECT * FROM event_players WHERE id = ?', [req.params.playerId]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: remove player (owner only)
router.delete('/:id/players/:playerId', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event || event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM event_players WHERE id = ?', [req.params.playerId]);
    eventStream.broadcast(req.params.id);
    res.json({ message: 'Player removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: finish event (owner only)
router.post('/:id/finish', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await db.run("UPDATE events SET status = 'completed' WHERE id = ?", [req.params.id]);
    eventStream.broadcast(req.params.id);
    res.json(await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: start next round, or advance the playoff bracket if the current round is a playoff round (owner only)
router.post('/:id/rounds', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    let currentRoundRow = null;
    if (event.current_round > 0) {
      currentRoundRow = await db.get(
        'SELECT * FROM rounds WHERE event_id = ? AND round_number = ?',
        [req.params.id, event.current_round]
      );
      if (currentRoundRow) {
        const pending = await pendingResultsCount(currentRoundRow.id);
        if (pending > 0) {
          return res.status(400).json({ error: `Round ${event.current_round} ainda tem ${pending} resultado(s) pendente(s)` });
        }
      }
    }

    const podSize = event.pod_size || 2;
    const roundNumber = event.current_round + 1;

    if (currentRoundRow?.is_playoff) {
      // Advance the bracket: resolve who advances out of each pod of the current playoff round
      const prevPairings = await db.query(
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
        await db.run("UPDATE events SET status = 'completed', champion_id = ? WHERE id = ?", [championId, req.params.id]);
        eventStream.broadcast(req.params.id);
        return res.json({ champion: true, event: await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]) });
      }

      const advancingPlayers = await db.query(
        `SELECT * FROM event_players WHERE id IN (${advancers.map(() => '?').join(',')})`,
        advancers
      );
      const orderedAdvancers = advancers.map((id) => advancingPlayers.find((p) => p.id === id));

      const roundId = uuidv4();
      const stage = playoffStageLabel(orderedAdvancers.length, podSize);
      await db.run(
        'INSERT INTO rounds (id, event_id, round_number, is_playoff, playoff_stage) VALUES (?, ?, ?, 1, ?)',
        [roundId, req.params.id, roundNumber, stage]
      );
      await insertPods(req.params.id, roundId, seedPlayoffPods(orderedAdvancers, podSize), event.points_win);

      await db.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?',
        [roundNumber, 'ongoing', req.params.id]);

      eventStream.broadcast(req.params.id);
      return res.status(201).json({
        round: await db.get('SELECT * FROM rounds WHERE id = ?', [roundId]),
        pairings: await db.query('SELECT * FROM pairings WHERE round_id = ?', [roundId]),
      });
    }

    // Regular Swiss round
    const players = await db.query(
      "SELECT * FROM event_players WHERE event_id = ? AND status = 'active'",
      [req.params.id]
    );
    if (players.length < 2) return res.status(400).json({ error: 'Need at least 2 active players' });

    const pastPairings = await db.query('SELECT * FROM pairings WHERE event_id = ?', [req.params.id]);
    const pods = generateSwissPairings(players, podSize, event.pairing_method, pastPairings);

    if (!event.allow_byes && pods.some((p) => !p.player2)) {
      return res.status(400).json({ error: 'Número de jogadores não forma pods completos e Byes estão desativados para este evento.' });
    }

    const roundId = uuidv4();
    await db.run('INSERT INTO rounds (id, event_id, round_number) VALUES (?, ?, ?)',
      [roundId, req.params.id, roundNumber]);
    await insertPods(req.params.id, roundId, pods, event.points_win);

    await db.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?',
      [roundNumber, 'ongoing', req.params.id]);

    const round = await db.get('SELECT * FROM rounds WHERE id = ?', [roundId]);
    const pairings = await db.query('SELECT * FROM pairings WHERE round_id = ?', [roundId]);
    eventStream.broadcast(req.params.id);
    res.status(201).json({ round, pairings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: start the playoff bracket (owner only) — seeds top N players by standings into a single-elimination round
router.post('/:id/playoffs/start', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (!event.playoff_structure || event.playoff_structure === 'none')
      return res.status(400).json({ error: 'This event has no playoff structure configured' });

    const existingPlayoffRound = await db.get(
      'SELECT id FROM rounds WHERE event_id = ? AND is_playoff = 1 LIMIT 1',
      [req.params.id]
    );
    if (existingPlayoffRound) return res.status(400).json({ error: 'Playoffs already started' });

    if (event.current_round > 0) {
      const currentRoundRow = await db.get(
        'SELECT id FROM rounds WHERE event_id = ? AND round_number = ?',
        [req.params.id, event.current_round]
      );
      if (currentRoundRow) {
        const pending = await pendingResultsCount(currentRoundRow.id);
        if (pending > 0) {
          return res.status(400).json({ error: `Round ${event.current_round} ainda tem ${pending} resultado(s) pendente(s)` });
        }
      }
    }

    const PLAYOFF_SIZES = { top4: 4, top8: 8, top16: 16 };
    const N = PLAYOFF_SIZES[event.playoff_structure] ?? 8;
    const standings = await db.query(
      "SELECT * FROM event_players WHERE event_id = ? AND status = 'active' ORDER BY points DESC, wins DESC",
      [req.params.id]
    );
    const seeds = standings.slice(0, Math.min(N, standings.length));
    if (seeds.length < 2) return res.status(400).json({ error: 'Not enough active players for playoffs' });

    const podSize = event.pod_size || 2;
    const roundNumber = event.current_round + 1;
    const roundId = uuidv4();
    const stage = playoffStageLabel(seeds.length, podSize);
    await db.run(
      'INSERT INTO rounds (id, event_id, round_number, is_playoff, playoff_stage) VALUES (?, ?, ?, 1, ?)',
      [roundId, req.params.id, roundNumber, stage]
    );
    await insertPods(req.params.id, roundId, seedPlayoffPods(seeds, podSize), event.points_win);

    await db.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?',
      [roundNumber, 'ongoing', req.params.id]);

    const round = await db.get('SELECT * FROM rounds WHERE id = ?', [roundId]);
    const pairings = await db.query('SELECT * FROM pairings WHERE round_id = ?', [roundId]);
    eventStream.broadcast(req.params.id);
    res.status(201).json({ round, pairings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: undo the latest round (owner only) — removes its pairings/results and reopens it for re-pairing
router.post('/:id/rounds/undo', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (event.current_round <= 0) return res.status(400).json({ error: 'No round to undo' });

    const round = await db.get(
      'SELECT * FROM rounds WHERE event_id = ? AND round_number = ?',
      [req.params.id, event.current_round]
    );
    if (!round) return res.status(404).json({ error: 'Round not found' });

    const undoWin  = async (id) => id && await db.run('UPDATE event_players SET wins=wins-1,   points=points-? WHERE id=?', [event.points_win, id]);
    const undoLoss = async (id) => id && await db.run('UPDATE event_players SET losses=losses-1, points=points-? WHERE id=?', [event.points_loss, id]);
    const undoDraw = async (id) => id && await db.run('UPDATE event_players SET draws=draws-1,  points=points-? WHERE id=?', [event.points_draw, id]);
    const winnerKey = { player1: 'player1_id', player2: 'player2_id', player3: 'player3_id', player4: 'player4_id' };

    const pairings = await db.query('SELECT * FROM pairings WHERE round_id = ?', [round.id]);
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

    await db.run('DELETE FROM pairings WHERE round_id = ?', [round.id]);
    await db.run('DELETE FROM rounds WHERE id = ?', [round.id]);

    const newRoundNumber = event.current_round - 1;
    await db.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?', [
      newRoundNumber,
      newRoundNumber === 0 ? 'upcoming' : 'ongoing',
      req.params.id,
    ]);

    eventStream.broadcast(req.params.id);
    res.json(await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: swap two players' seats within the current round (owner only) — both matches must still be pending
router.post('/:id/rounds/swap', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (event.current_round <= 0) return res.status(400).json({ error: 'No active round' });

    const { player1Id, player2Id } = req.body;
    if (!player1Id || !player2Id || player1Id === player2Id)
      return res.status(400).json({ error: 'Two different players are required' });

    const round = await db.get(
      'SELECT * FROM rounds WHERE event_id = ? AND round_number = ?',
      [req.params.id, event.current_round]
    );
    if (!round) return res.status(404).json({ error: 'Round not found' });

    const pairings = await db.query('SELECT * FROM pairings WHERE round_id = ?', [round.id]);
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
    if (!loc1 || !loc2) return res.status(404).json({ error: 'Player not found in current round' });
    if (loc1.pairing.result || loc2.pairing.result)
      return res.status(400).json({ error: 'Cannot swap players whose match already has a result' });

    if (loc1.pairing.id === loc2.pairing.id) {
      await db.run(
        `UPDATE pairings SET ${loc1.col} = ?, ${loc2.col} = ? WHERE id = ?`,
        [player2Id, player1Id, loc1.pairing.id]
      );
    } else {
      await db.run(`UPDATE pairings SET ${loc1.col} = ? WHERE id = ?`, [player2Id, loc1.pairing.id]);
      await db.run(`UPDATE pairings SET ${loc2.col} = ? WHERE id = ?`, [player1Id, loc2.pairing.id]);
    }

    eventStream.broadcast(req.params.id);
    res.json({ message: 'Players swapped' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: submit result (owner only)
// result: 'player1'|'player2'|'player3'|'player4' = that player won; 'draw' = all draw; 'bye' = auto win
router.put('/:id/pairings/:pairingId', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const pairing = await db.get('SELECT * FROM pairings WHERE id = ?', [req.params.pairingId]);
    if (!pairing) return res.status(404).json({ error: 'Pairing not found' });

    const { result } = req.body;
    const valid = ['player1', 'player2', 'player3', 'player4', 'draw', 'bye'];
    if (!valid.includes(result)) return res.status(400).json({ error: 'Invalid result' });

    const isOwner = event.owner_id === req.user.id;
    if (!isOwner) {
      // Player-Reported Results: a seated player may self-report the outcome of their own
      // still-pending match. In a 1v1 they can report a win, a loss, or a draw. In a
      // multiplayer pod only "I Won" (unambiguous: everyone else lost) or "Draw" are allowed —
      // reporting a loss wouldn't say who among the other seats actually won.
      const seatedPlayer = await db.get(
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
      if (!canSelfReport) return res.status(403).json({ error: 'Forbidden' });
    }

    // Organizer-set results are confirmed immediately (they're the authority). A player's own
    // self-report needs the organizer's approval before it counts towards standings.
    const newStatus = isOwner ? 'confirmed' : 'pending';

    const win  = async (id) => id && await db.run('UPDATE event_players SET wins=wins+1,   points=points+? WHERE id=?', [event.points_win, id]);
    const loss = async (id) => id && await db.run('UPDATE event_players SET losses=losses+1, points=points+? WHERE id=?', [event.points_loss, id]);
    const draw = async (id) => id && await db.run('UPDATE event_players SET draws=draws+1,  points=points+? WHERE id=?', [event.points_draw, id]);
    const undoWin  = async (id) => id && await db.run('UPDATE event_players SET wins=wins-1,   points=points-? WHERE id=?', [event.points_win, id]);
    const undoLoss = async (id) => id && await db.run('UPDATE event_players SET losses=losses-1, points=points-? WHERE id=?', [event.points_loss, id]);
    const undoDraw = async (id) => id && await db.run('UPDATE event_players SET draws=draws-1,  points=points-? WHERE id=?', [event.points_draw, id]);

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

    await db.run('UPDATE pairings SET result = ?, result_status = ? WHERE id = ?', [result, newStatus, req.params.pairingId]);

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

    const pending = await pendingResultsCount(pairing.round_id);
    await db.run('UPDATE rounds SET status = ? WHERE id = ?',
      [pending === 0 ? 'completed' : 'active', pairing.round_id]);

    eventStream.broadcast(req.params.id);
    res.json(await db.get('SELECT * FROM pairings WHERE id = ?', [req.params.pairingId]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: approve a player-submitted result (owner only) — applies its already-stored points
router.post('/:id/pairings/:pairingId/approve', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const pairing = await db.get('SELECT * FROM pairings WHERE id = ?', [req.params.pairingId]);
    if (!pairing) return res.status(404).json({ error: 'Pairing not found' });
    if (!pairing.result) return res.status(400).json({ error: 'No result to approve' });
    if (pairing.result_status === 'confirmed') return res.status(400).json({ error: 'Result already confirmed' });

    const win  = async (id) => id && await db.run('UPDATE event_players SET wins=wins+1,   points=points+? WHERE id=?', [event.points_win, id]);
    const loss = async (id) => id && await db.run('UPDATE event_players SET losses=losses+1, points=points+? WHERE id=?', [event.points_loss, id]);
    const draw = async (id) => id && await db.run('UPDATE event_players SET draws=draws+1,  points=points+? WHERE id=?', [event.points_draw, id]);

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

    await db.run("UPDATE pairings SET result_status = 'confirmed' WHERE id = ?", [req.params.pairingId]);

    const pending = await pendingResultsCount(pairing.round_id);
    await db.run('UPDATE rounds SET status = ? WHERE id = ?',
      [pending === 0 ? 'completed' : 'active', pairing.round_id]);

    eventStream.broadcast(req.params.id);
    res.json(await db.get('SELECT * FROM pairings WHERE id = ?', [req.params.pairingId]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
