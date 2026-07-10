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

// Auth: get my events (must be before /:id)
router.get('/user/mine', auth, (req, res) => {
  const owned = db.prepare(`
    SELECT e.*, (SELECT COUNT(*) FROM event_players ep WHERE ep.event_id = e.id AND ep.status = 'active') as player_count
    FROM events e WHERE e.owner_id = ? ORDER BY e.date ASC
  `).all(req.user.id);
  const joined = db.prepare(`
    SELECT e.*, (SELECT COUNT(*) FROM event_players ep2 WHERE ep2.event_id = e.id AND ep2.status = 'active') as player_count
    FROM events e
    JOIN event_players ep ON ep.event_id = e.id
    WHERE ep.user_id = ? AND e.owner_id != ?
    ORDER BY e.date ASC
  `).all(req.user.id, req.user.id);
  res.json({ owned, joined });
});

// Public: list upcoming events with optional search
router.get('/', (req, res) => {
  const { q, past } = req.query;
  const now = new Date().toISOString();
  let sql = 'SELECT e.*, u.display_name as owner_name, (SELECT COUNT(*) FROM event_players ep WHERE ep.event_id = e.id AND ep.status = \'active\') as player_count FROM events e JOIN users u ON u.id = e.owner_id WHERE e.test_event = 0';
  const params = [];
  if (past === 'true') {
    sql += ' AND e.date < ?';
    params.push(now);
  } else {
    sql += ' AND e.date >= ?';
    params.push(now);
  }
  if (q) {
    sql += ' AND (e.name LIKE ? OR e.description LIKE ? OR e.game LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY e.date ASC';
  res.json(db.prepare(sql).all(...params));
});

// Public: get single event
router.get('/:id', (req, res) => {
  const event = db.prepare(
    'SELECT e.*, u.display_name as owner_name FROM events e JOIN users u ON u.id = e.owner_id WHERE e.id = ?'
  ).get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const players = db.prepare(
    'SELECT ep.*, u.display_name FROM event_players ep JOIN users u ON u.id = ep.user_id WHERE ep.event_id = ? ORDER BY ep.points DESC, ep.wins DESC'
  ).all(req.params.id);

  const rounds = db.prepare('SELECT * FROM rounds WHERE event_id = ? ORDER BY round_number').all(req.params.id);
  const pairings = rounds.length
    ? db.prepare('SELECT p.*, ep1.display_name as p1_name, ep2.display_name as p2_name FROM pairings p LEFT JOIN event_players ep1 ON ep1.id = p.player1_id LEFT JOIN event_players ep2 ON ep2.id = p.player2_id WHERE p.event_id = ? ORDER BY p.table_number').all(req.params.id)
    : [];

  res.json({ ...event, players, rounds, pairings });
});

// Auth: create event
router.post('/', auth, upload.single('thumbnail'), (req, res) => {
  const {
    name, description, city, address, online, date, game, format,
    pairing_method, playoff_structure, allow_byes, test_event,
    collaborative_deck, async_draws, confirm_players,
  } = req.body;

  if (!name || !date || !game) {
    return res.status(400).json({ error: 'Name, date and game are required' });
  }

  const id = uuidv4();
  const thumbnail = req.file ? `/uploads/${req.file.filename}` : null;
  const parseBool = (v) => v === 'true' || v === true || v === 1 || v === '1';

  db.prepare(`
    INSERT INTO events (id, name, description, city, address, online, thumbnail, date, game, format,
      pairing_method, playoff_structure, allow_byes, test_event, collaborative_deck, async_draws,
      confirm_players, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, description || null, city || null, address || null,
    parseBool(online) ? 1 : 0,
    thumbnail, date, game, format || null,
    pairing_method || 'swiss', playoff_structure || 'none',
    parseBool(allow_byes) ? 1 : 0, parseBool(test_event) ? 1 : 0,
    parseBool(collaborative_deck) ? 1 : 0, parseBool(async_draws) ? 1 : 0,
    parseBool(confirm_players) ? 1 : 0, req.user.id
  );

  res.status(201).json(db.prepare('SELECT * FROM events WHERE id = ?').get(id));
});

// Auth: update event (owner only)
router.put('/:id', auth, upload.single('thumbnail'), (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const {
    name, description, city, address, online, date, game, format,
    pairing_method, playoff_structure, allow_byes, test_event,
    collaborative_deck, async_draws, confirm_players, status,
  } = req.body;

  const thumbnail = req.file ? `/uploads/${req.file.filename}` : event.thumbnail;

  db.prepare(`
    UPDATE events SET name=?, description=?, city=?, address=?, online=?, thumbnail=?, date=?,
    game=?, format=?, pairing_method=?, playoff_structure=?, allow_byes=?, test_event=?,
    collaborative_deck=?, async_draws=?, confirm_players=?, status=? WHERE id=?
  `).run(
    name || event.name, description ?? event.description, city ?? event.city,
    address ?? event.address, online !== undefined ? (online ? 1 : 0) : event.online,
    thumbnail, date || event.date, game || event.game, format ?? event.format,
    pairing_method || event.pairing_method, playoff_structure || event.playoff_structure,
    allow_byes !== undefined ? (allow_byes ? 1 : 0) : event.allow_byes,
    test_event !== undefined ? (test_event ? 1 : 0) : event.test_event,
    collaborative_deck !== undefined ? (collaborative_deck ? 1 : 0) : event.collaborative_deck,
    async_draws !== undefined ? (async_draws ? 1 : 0) : event.async_draws,
    confirm_players !== undefined ? (confirm_players ? 1 : 0) : event.confirm_players,
    status || event.status, req.params.id
  );

  res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id));
});

// Auth: delete event (owner only)
router.delete('/:id', auth, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM pairings WHERE event_id = ?').run(req.params.id);
  db.prepare('DELETE FROM rounds WHERE event_id = ?').run(req.params.id);
  db.prepare('DELETE FROM event_players WHERE event_id = ?').run(req.params.id);
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ message: 'Event deleted' });
});

// Auth: join event
router.post('/:id/join', auth, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const existing = db.prepare('SELECT * FROM event_players WHERE event_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (existing) return res.status(409).json({ error: 'Already joined' });

  const id = uuidv4();
  db.prepare('INSERT INTO event_players (id, event_id, user_id, display_name) VALUES (?, ?, ?, ?)')
    .run(id, req.params.id, req.user.id, req.user.display_name);

  res.status(201).json({ message: 'Joined event' });
});

// Auth: leave event
router.delete('/:id/join', auth, (req, res) => {
  db.prepare('DELETE FROM event_players WHERE event_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: 'Left event' });
});

// Auth: get players
router.get('/:id/players', (req, res) => {
  const players = db.prepare(
    'SELECT ep.*, u.display_name FROM event_players ep JOIN users u ON u.id = ep.user_id WHERE ep.event_id = ? ORDER BY ep.points DESC, ep.wins DESC'
  ).all(req.params.id);
  res.json(players);
});

// Auth: add player by email (owner only)
router.post('/:id/players', auth, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const { email, display_name } = req.body;
  let user = null;
  if (email) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(404).json({ error: 'User not found with that email' });
  }

  const userId = user ? user.id : null;
  const name = (user ? user.display_name : display_name) || 'Guest';

  if (userId) {
    const existing = db.prepare('SELECT * FROM event_players WHERE event_id = ? AND user_id = ?').get(req.params.id, userId);
    if (existing) return res.status(409).json({ error: 'Player already in event' });
  }

  const id = uuidv4();
  db.prepare('INSERT INTO event_players (id, event_id, user_id, display_name) VALUES (?, ?, ?, ?)')
    .run(id, req.params.id, userId, name);

  res.status(201).json(db.prepare('SELECT * FROM event_players WHERE id = ?').get(id));
});

// Auth: update player (deck name, status)
router.put('/:id/players/:playerId', auth, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const player = db.prepare('SELECT * FROM event_players WHERE id = ?').get(req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const isOwner = event.owner_id === req.user.id;
  const isSelf = player.user_id === req.user.id;
  if (!isOwner && !isSelf) return res.status(403).json({ error: 'Forbidden' });

  const { deck_name, status } = req.body;
  db.prepare('UPDATE event_players SET deck_name=?, status=? WHERE id=?')
    .run(deck_name ?? player.deck_name, status ?? player.status, req.params.playerId);

  res.json(db.prepare('SELECT * FROM event_players WHERE id = ?').get(req.params.playerId));
});

// Auth: remove player (owner only)
router.delete('/:id/players/:playerId', auth, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event || event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM event_players WHERE id = ?').run(req.params.playerId);
  res.json({ message: 'Player removed' });
});

// Auth: start next round (owner only)
router.post('/:id/rounds', auth, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const players = db.prepare(
    "SELECT * FROM event_players WHERE event_id = ? AND status = 'active'"
  ).all(req.params.id);
  if (players.length < 2) return res.status(400).json({ error: 'Need at least 2 active players' });

  const roundNumber = event.current_round + 1;
  const roundId = uuidv4();
  db.prepare('INSERT INTO rounds (id, event_id, round_number) VALUES (?, ?, ?)').run(roundId, req.params.id, roundNumber);

  const pairs = generateSwissPairings(players);
  pairs.forEach((pair, idx) => {
    db.prepare('INSERT INTO pairings (id, round_id, event_id, player1_id, player2_id, table_number) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), roundId, req.params.id, pair.player1.id, pair.player2 ? pair.player2.id : null, idx + 1);
  });

  db.prepare('UPDATE events SET current_round = ?, status = ? WHERE id = ?').run(roundNumber, 'ongoing', req.params.id);

  const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);
  const pairings = db.prepare('SELECT * FROM pairings WHERE round_id = ?').all(roundId);
  res.status(201).json({ round, pairings });
});

// Auth: submit result for a pairing (owner only)
router.put('/:id/pairings/:pairingId', auth, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event || event.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const pairing = db.prepare('SELECT * FROM pairings WHERE id = ?').get(req.params.pairingId);
  if (!pairing) return res.status(404).json({ error: 'Pairing not found' });

  const { result } = req.body; // 'player1' | 'player2' | 'draw' | 'bye'
  if (!['player1', 'player2', 'draw', 'bye'].includes(result)) {
    return res.status(400).json({ error: 'Invalid result' });
  }

  db.prepare('UPDATE pairings SET result = ? WHERE id = ?').run(result, req.params.pairingId);

  // Update player stats
  const updatePlayer = (playerId, win, loss, draw) => {
    const pts = win ? 3 : draw ? 1 : 0;
    db.prepare('UPDATE event_players SET wins=wins+?, losses=losses+?, draws=draws+?, points=points+? WHERE id=?')
      .run(win ? 1 : 0, loss ? 1 : 0, draw ? 1 : 0, pts, playerId);
  };

  if (result === 'player1') { updatePlayer(pairing.player1_id, true, false, false); if (pairing.player2_id) updatePlayer(pairing.player2_id, false, true, false); }
  else if (result === 'player2') { if (pairing.player2_id) { updatePlayer(pairing.player2_id, true, false, false); updatePlayer(pairing.player1_id, false, true, false); } }
  else if (result === 'draw') { updatePlayer(pairing.player1_id, false, false, true); if (pairing.player2_id) updatePlayer(pairing.player2_id, false, false, true); }
  else if (result === 'bye') { updatePlayer(pairing.player1_id, true, false, false); }

  res.json(db.prepare('SELECT * FROM pairings WHERE id = ?').get(req.params.pairingId));
});

module.exports = router;
