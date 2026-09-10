const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');
const requireOrganizer = require('../middleware/requireOrganizer');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { HttpError, asyncHandler } = require('../lib/http');

const parseBool = (v) => v === 'true' || v === true || v === 1 || v === '1';

// Auth: leagues owned by the current user (must be before /:id)
router.get('/mine', auth, asyncHandler(async (req, res) => {
  const leagues = await db.query(
    `SELECT l.*, (SELECT COUNT(*) FROM events e WHERE e.league_id = l.id) as event_count
     FROM leagues l WHERE l.owner_id = ? ORDER BY l.created_at DESC`,
    [req.user.id]
  );
  res.json(leagues);
}));

// Public: list all leagues
router.get('/', asyncHandler(async (req, res) => {
  const leagues = await db.query(
    `SELECT l.*, u.display_name as owner_name,
       (SELECT COUNT(*) FROM events e WHERE e.league_id = l.id) as event_count
     FROM leagues l JOIN users u ON u.id = l.owner_id
     ORDER BY l.created_at DESC`
  );
  res.json(leagues);
}));

// Public: league detail — member events + aggregated standings
router.get('/:id', asyncHandler(async (req, res) => {
  const league = await db.get(
    `SELECT l.*, u.display_name as owner_name FROM leagues l JOIN users u ON u.id = l.owner_id WHERE l.id = ?`,
    [req.params.id]
  );
  if (!league) throw new HttpError(404, 'League not found', 'api.leagueNotFound');

  const events = await db.query(
    'SELECT id, name, date, status, thumbnail, game, format, points_win, points_draw, points_loss FROM events WHERE league_id = ? ORDER BY date',
    [req.params.id]
  );

  // user_id -> { user_id, display_name, points, wins, losses, draws }
  const totals = new Map();
  const bump = (userId, displayName, points, wins, losses, draws) => {
    const cur = totals.get(userId) ?? { user_id: userId, display_name: displayName, points: 0, wins: 0, losses: 0, draws: 0, events_played: 0 };
    cur.points += points;
    cur.wins += wins;
    cur.losses += losses;
    cur.draws += draws;
    cur.events_played += 1;
    totals.set(userId, cur);
  };

  // Duas queries para a liga inteira, não duas por evento: em liga com dezenas de
  // torneios o laço antigo virava dezenas de idas ao banco por request.
  const eventIds = events.map((e) => e.id);
  const placeholders = eventIds.map(() => '?').join(',');

  // Só jogadores com conta podem ser correlacionados entre eventos diferentes;
  // convidados avulsos existem apenas dentro do próprio torneio.
  const allPlayers = eventIds.length
    ? await db.query(
        `SELECT * FROM event_players
         WHERE event_id IN (${placeholders}) AND status = 'active' AND user_id IS NOT NULL`,
        eventIds
      )
    : [];

  // A pontuação de liga sai sempre das mesas confirmadas, nunca de um total
  // gravado: um total corrido carrega a escala de pontos vigente na hora de cada
  // resultado, e basta o organizador mexer em points_win no meio do torneio para
  // ele passar a somar duas escalas diferentes. `playoff_counts` decide apenas
  // se as rodadas de mata-mata entram na conta.
  const contaPlayoff = Boolean(league.playoff_counts);
  const scoredPairings = eventIds.length
    ? await db.query(
        `SELECT pr.* FROM pairings pr JOIN rounds r ON r.id = pr.round_id
         WHERE pr.event_id IN (${placeholders})
           ${contaPlayoff ? '' : 'AND r.is_playoff = 0'}
           AND pr.result IS NOT NULL AND pr.result_status = 'confirmed'`,
        eventIds
      )
    : [];

  const playersByEvent = new Map();
  for (const p of allPlayers) {
    if (!playersByEvent.has(p.event_id)) playersByEvent.set(p.event_id, []);
    playersByEvent.get(p.event_id).push(p);
  }
  const pairingsByEvent = new Map();
  for (const pr of scoredPairings) {
    if (!pairingsByEvent.has(pr.event_id)) pairingsByEvent.set(pr.event_id, []);
    pairingsByEvent.get(pr.event_id).push(pr);
  }

  const winnerKey = { player1: 'player1_id', player2: 'player2_id', player3: 'player3_id', player4: 'player4_id' };

  for (const ev of events) {
    const players = playersByEvent.get(ev.id) ?? [];
    if (players.length === 0) continue;

    const perPlayer = new Map(); // event_players.id -> { wins, losses, draws }
    const record = (id, w, l, d) => {
      const c = perPlayer.get(id) ?? { wins: 0, losses: 0, draws: 0 };
      c.wins += w; c.losses += l; c.draws += d;
      perPlayer.set(id, c);
    };
    for (const pr of pairingsByEvent.get(ev.id) ?? []) {
      const seats = [pr.player1_id, pr.player2_id, pr.player3_id, pr.player4_id].filter(Boolean);
      if (pr.result === 'draw') {
        for (const s of seats) record(s, 0, 0, 1);
      } else if (pr.result === 'bye') {
        for (const s of seats) record(s, 1, 0, 0);
      } else if (winnerKey[pr.result]) {
        const winnerId = pr[winnerKey[pr.result]];
        for (const s of seats) record(s, s === winnerId ? 1 : 0, s === winnerId ? 0 : 1, 0);
      }
    }
    for (const p of players) {
      const c = perPlayer.get(p.id) ?? { wins: 0, losses: 0, draws: 0 };
      const points = c.wins * ev.points_win + c.draws * ev.points_draw + c.losses * ev.points_loss;
      bump(p.user_id, p.display_name, points, c.wins, c.losses, c.draws);
    }
  }

  const standings = [...totals.values()].sort((a, b) => b.points - a.points || b.wins - a.wins);

  res.json({ ...league, events, standings });
}));

// Auth: create league (organizer only)
router.post('/', auth, requireOrganizer, validate(schemas.createLeague), asyncHandler(async (req, res) => {
  const { name, playoff_counts } = req.body;
  const id = uuidv4();
  await db.run(
    'INSERT INTO leagues (id, name, owner_id, playoff_counts) VALUES (?, ?, ?, ?)',
    [id, name, req.user.id, playoff_counts === undefined ? 1 : (parseBool(playoff_counts) ? 1 : 0)]
  );
  res.status(201).json(await db.get('SELECT * FROM leagues WHERE id = ?', [id]));
}));

// Auth: update league (owner only)
router.put('/:id', auth, validate(schemas.updateLeague), asyncHandler(async (req, res) => {
  const league = await db.get('SELECT * FROM leagues WHERE id = ?', [req.params.id]);
  if (!league) throw new HttpError(404, 'League not found', 'api.leagueNotFound');
  if (league.owner_id !== req.user.id) throw new HttpError(403, 'Forbidden', 'api.forbidden');

  const { name, playoff_counts } = req.body;
  await db.run('UPDATE leagues SET name = ?, playoff_counts = ? WHERE id = ?', [
    name || league.name,
    playoff_counts !== undefined ? (parseBool(playoff_counts) ? 1 : 0) : league.playoff_counts,
    req.params.id,
  ]);
  res.json(await db.get('SELECT * FROM leagues WHERE id = ?', [req.params.id]));
}));

// Auth: delete league (owner only) — member events just lose their league_id (ON DELETE SET NULL)
router.delete('/:id', auth, asyncHandler(async (req, res) => {
  const league = await db.get('SELECT * FROM leagues WHERE id = ?', [req.params.id]);
  if (!league) throw new HttpError(404, 'League not found', 'api.leagueNotFound');
  if (league.owner_id !== req.user.id) throw new HttpError(403, 'Forbidden', 'api.forbidden');

  await db.run('DELETE FROM leagues WHERE id = ?', [req.params.id]);
  res.json({ message: 'League deleted' });
}));

module.exports = router;
