const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');
const requireOrganizer = require('../middleware/requireOrganizer');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { HttpError, asyncHandler } = require('../lib/http');
const { computeStandings } = require('../services/standings');

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
  const bump = (userId, displayName, { points, wins, losses, draws }) => {
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

  // Todos os jogadores do evento, e não só os que têm conta: `computeStandings`
  // precisa do elenco inteiro para saber quem enfrentou quem. Quem não tem conta
  // é descartado só na hora de somar, porque é ali que a restrição vale — um
  // convidado avulso não pode ser correlacionado entre torneios diferentes.
  const allPlayers = eventIds.length
    ? await db.query(`SELECT * FROM event_players WHERE event_id IN (${placeholders})`, eventIds)
    : [];

  // A pontuação de liga sai sempre das mesas confirmadas, nunca de um total
  // gravado: um total corrido carrega a escala de pontos vigente na hora de cada
  // resultado, e basta o organizador mexer em points_win no meio do torneio para
  // ele passar a somar duas escalas diferentes. `playoff_counts` decide apenas
  // se as rodadas de mata-mata entram na conta.
  const contaPlayoff = Boolean(league.playoff_counts);
  const scoredPairings = eventIds.length
    ? await db.query(
        `SELECT pr.*, r.is_playoff FROM pairings pr JOIN rounds r ON r.id = pr.round_id
         WHERE pr.event_id IN (${placeholders})
           ${contaPlayoff ? '' : 'AND r.is_playoff = 0'}`,
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

  // Quem conta a pontuação é `computeStandings`, e mais ninguém.
  //
  // Esta rota tinha um laço próprio, escrito antes de a mesa de duplas existir:
  // ele dava a vitória ao assento apontado por `result` e derrota a todos os
  // outros. Numa mesa de duplas — o mata-mata do Clã Fronto, e toda rodada do
  // partner — isso registrava o parceiro do vencedor como derrotado, e a liga
  // discordava da classificação do próprio evento que a alimentava.
  //
  // Era a quarta aparição do mesmo defeito: dois lugares respondendo à mesma
  // pergunta. Aqui a resposta passou a vir de onde ela já era certa.
  for (const ev of events) {
    const players = playersByEvent.get(ev.id) ?? [];
    if (players.length === 0) continue;

    const ranked = computeStandings(players, pairingsByEvent.get(ev.id) ?? [], ev);
    for (const p of ranked) {
      // Convidado sem conta existe só dentro do próprio torneio: não há a quem
      // creditar entre eventos diferentes. Quem deu drop também fica de fora —
      // é a regra que já valia aqui, e mudá-la é decisão de produto, não efeito
      // colateral de trocar quem faz a conta.
      if (!p.user_id || p.status !== 'active') continue;
      bump(p.user_id, p.display_name, p);
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
