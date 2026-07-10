const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const auth = require('../middleware/auth');
const { generateSwissPairings } = require('../services/pairing');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (_, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const parseBool = (v) => v === 'true' || v === true || v === 1 || v === '1';

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
    if (past === 'true') { sql += ' AND e.date < ?'; params.push(now); }
    else { sql += ' AND e.date >= ?'; params.push(now); }
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
          `SELECT p.*, ep1.display_name as p1_name, ep2.display_name as p2_name
           FROM pairings p
           LEFT JOIN event_players ep1 ON ep1.id = p.player1_id
           LEFT JOIN event_players ep2 ON ep2.id = p.player2_id
           WHERE p.event_id = ? ORDER BY p.table_number`,
          [req.params.id]
        )
      : [];

    res.json({ ...event, players, rounds, pairings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: create event
router.post('/', auth, upload.single('thumbnail'), async (req, res) => {
  try {
    const {
      name, description, city, address, online, date, game, format,
      pairing_method, playoff_structure, allow_byes, test_event,
      collaborative_deck, async_draws, confirm_players,
    } = req.body;
    if (!name || !date || !game)
      return res.status(400).json({ error: 'Name, date and game are required' });

    const id = uuidv4();
    const thumbnail = req.file ? `/uploads/${req.file.filename}` : null;

    await db.run(`
      INSERT INTO events (id, name, description, city, address, online, thumbnail, date, game, format,
        pairing_method, playoff_structure, allow_byes, test_event, collaborative_deck, async_draws,
        confirm_players, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, name, description || null, city || null, address || null,
      parseBool(online) ? 1 : 0, thumbnail, date, game, format || null,
      pairing_method || 'swiss', playoff_structure || 'none',
      parseBool(allow_byes) ? 1 : 0, parseBool(test_event) ? 1 : 0,
      parseBool(collaborative_deck) ? 1 : 0, parseBool(async_draws) ? 1 : 0,
      parseBool(confirm_players) ? 1 : 0, req.user.id,
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
      pairing_method, playoff_structure, allow_byes, test_event,
      collaborative_deck, async_draws, confirm_players, status,
    } = req.body;

    const thumbnail = req.file ? `/uploads/${req.file.filename}` : event.thumbnail;

    await db.run(`
      UPDATE events SET name=?, description=?, city=?, address=?, online=?, thumbnail=?, date=?,
      game=?, format=?, pairing_method=?, playoff_structure=?, allow_byes=?, test_event=?,
      collaborative_deck=?, async_draws=?, confirm_players=?, status=? WHERE id=?
    `, [
      name || event.name, description ?? event.description, city ?? event.city,
      address ?? event.address, online !== undefined ? (parseBool(online) ? 1 : 0) : event.online,
      thumbnail, date || event.date, game || event.game, format ?? event.format,
      pairing_method || event.pairing_method, playoff_structure || event.playoff_structure,
      allow_byes !== undefined ? (parseBool(allow_byes) ? 1 : 0) : event.allow_byes,
      test_event !== undefined ? (parseBool(test_event) ? 1 : 0) : event.test_event,
      collaborative_deck !== undefined ? (parseBool(collaborative_deck) ? 1 : 0) : event.collaborative_deck,
      async_draws !== undefined ? (parseBool(async_draws) ? 1 : 0) : event.async_draws,
      confirm_players !== undefined ? (parseBool(confirm_players) ? 1 : 0) : event.confirm_players,
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
    const existing = await db.get(
      'SELECT id FROM event_players WHERE event_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (existing) return res.status(409).json({ error: 'Already joined' });

    await db.run(
      'INSERT INTO event_players (id, event_id, user_id, display_name) VALUES (?, ?, ?, ?)',
      [uuidv4(), req.params.id, req.user.id, req.user.display_name]
    );
    res.status(201).json({ message: 'Joined event' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: leave event
router.delete('/:id/join', auth, async (req, res) => {
  try {
    await db.run('DELETE FROM event_players WHERE event_id = ? AND user_id = ?',
      [req.params.id, req.user.id]);
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
    if (!isOwner && !isSelf) return res.status(403).json({ error: 'Forbidden' });

    const { deck_name, status } = req.body;
    await db.run('UPDATE event_players SET deck_name=?, status=? WHERE id=?', [
      deck_name ?? player.deck_name,
      status ?? player.status,
      req.params.playerId,
    ]);
    res.json(await db.get('SELECT * FROM event_players WHERE id = ?', [req.params.playerId]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: remove player (owner only)
router.delete('/:id/players/:playerId', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event || event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM event_players WHERE id = ?', [req.params.playerId]);
    res.json({ message: 'Player removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: start next round (owner only)
router.post('/:id/rounds', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const players = await db.query(
      "SELECT * FROM event_players WHERE event_id = ? AND status = 'active'",
      [req.params.id]
    );
    if (players.length < 2) return res.status(400).json({ error: 'Need at least 2 active players' });

    const roundNumber = event.current_round + 1;
    const roundId = uuidv4();
    await db.run('INSERT INTO rounds (id, event_id, round_number) VALUES (?, ?, ?)',
      [roundId, req.params.id, roundNumber]);

    const pairs = generateSwissPairings(players);
    for (let idx = 0; idx < pairs.length; idx++) {
      const pair = pairs[idx];
      await db.run(
        'INSERT INTO pairings (id, round_id, event_id, player1_id, player2_id, table_number) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), roundId, req.params.id, pair.player1.id, pair.player2 ? pair.player2.id : null, idx + 1]
      );
    }

    await db.run('UPDATE events SET current_round = ?, status = ? WHERE id = ?',
      [roundNumber, 'ongoing', req.params.id]);

    const round = await db.get('SELECT * FROM rounds WHERE id = ?', [roundId]);
    const pairings = await db.query('SELECT * FROM pairings WHERE round_id = ?', [roundId]);
    res.status(201).json({ round, pairings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth: submit result (owner only)
router.put('/:id/pairings/:pairingId', auth, async (req, res) => {
  try {
    const event = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event || event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const pairing = await db.get('SELECT * FROM pairings WHERE id = ?', [req.params.pairingId]);
    if (!pairing) return res.status(404).json({ error: 'Pairing not found' });

    const { result } = req.body;
    if (!['player1', 'player2', 'draw', 'bye'].includes(result))
      return res.status(400).json({ error: 'Invalid result' });

    await db.run('UPDATE pairings SET result = ? WHERE id = ?', [result, req.params.pairingId]);

    const updatePlayer = async (playerId, win, loss, draw) => {
      const pts = win ? 3 : draw ? 1 : 0;
      await db.run(
        'UPDATE event_players SET wins=wins+?, losses=losses+?, draws=draws+?, points=points+? WHERE id=?',
        [win ? 1 : 0, loss ? 1 : 0, draw ? 1 : 0, pts, playerId]
      );
    };

    if (result === 'player1') {
      await updatePlayer(pairing.player1_id, true, false, false);
      if (pairing.player2_id) await updatePlayer(pairing.player2_id, false, true, false);
    } else if (result === 'player2') {
      if (pairing.player2_id) {
        await updatePlayer(pairing.player2_id, true, false, false);
        await updatePlayer(pairing.player1_id, false, true, false);
      }
    } else if (result === 'draw') {
      await updatePlayer(pairing.player1_id, false, false, true);
      if (pairing.player2_id) await updatePlayer(pairing.player2_id, false, false, true);
    } else if (result === 'bye') {
      await updatePlayer(pairing.player1_id, true, false, false);
    }

    res.json(await db.get('SELECT * FROM pairings WHERE id = ?', [req.params.pairingId]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
