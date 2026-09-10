const { z } = require('zod');

/**
 * Request schemas for every write route.
 *
 * Two shapes of client feed these: JSON bodies, and multipart forms (event
 * create/update), where every field arrives as a string and an untouched
 * optional field arrives as ''. `blank` maps those empty strings to `undefined`
 * so the routes' existing "field wasn't sent → keep the stored value" fallbacks
 * keep working. `league_id` and `deck_name` are deliberately NOT blanked: for
 * those, '' is a real instruction ("detach the league", "clear the deck").
 */
const blank = (schema) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), schema);

const boolish = blank(z.union([z.boolean(), z.enum(['true', 'false', '0', '1'])]).optional());
const int = (min, max) => blank(z.coerce.number().int().min(min).max(max).optional());
const str = (max) => z.string().max(max).optional();

const dateString = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be a valid date');

const PAIRING_METHODS = ['swiss', 'swiss-less-repetition', 'avoid-repetition', 'random'];
const PLAYOFF_STRUCTURES = ['none', 'top4', 'top8', 'top16', 'clan2', 'clan4'];
const TOURNAMENT_FORMATS = ['standard', 'clafronto'];
const EVENT_STATUSES = ['upcoming', 'ongoing', 'completed'];
const PLAYER_STATUSES = ['active', 'pending', 'dropped'];
const RESULTS = ['player1', 'player2', 'player3', 'player4', 'draw', 'bye'];

// Column widths mirror db/init/01-schema.sql — validating here is what turns a
// raw "Data too long for column ..." driver error into a readable 400.
const eventFields = {
  description: str(5000),
  city: str(100),
  address: str(500),
  online: boolish,
  format: str(50),
  tournament_format: blank(z.enum(TOURNAMENT_FORMATS).optional()),
  pairing_method: blank(z.enum(PAIRING_METHODS).optional()),
  playoff_structure: blank(z.enum(PLAYOFF_STRUCTURES).optional()),
  allow_byes: boolish,
  test_event: boolish,
  collaborative_deck: boolish,
  async_draws: boolish,
  confirm_players: boolish,
  qr_code_enabled: boolish,
  league_id: str(36),
  pod_size: int(2, 4),
  round_minutes: int(5, 240),
  points_win: int(0, 10),
  points_draw: int(0, 10),
  points_loss: int(0, 10),
};

const schemas = {
  register: z.object({
    display_name: z.string().trim().min(1).max(100),
    email: z.email().max(255),
    password: z.string().min(6, 'must be at least 6 characters').max(200),
  }),

  // Deliberately looser than `register`: a malformed email here is just wrong
  // credentials, and should answer 401 like any other bad login.
  login: z.object({
    email: z.string().min(1).max(255),
    password: z.string().min(1).max(200),
  }),

  forgotPassword: z.object({ email: str(255) }),

  createEvent: z.object({
    name: z.string().trim().min(1).max(100),
    date: dateString,
    game: z.string().trim().min(1).max(50),
    ...eventFields,
  }),

  // Every field optional: the route merges what's sent over the stored event.
  updateEvent: z.object({
    name: blank(z.string().trim().min(1).max(100).optional()),
    date: blank(dateString.optional()),
    game: blank(z.string().trim().min(1).max(50).optional()),
    status: blank(z.enum(EVENT_STATUSES).optional()),
    ...eventFields,
  }),

  addPlayer: z.object({
    email: blank(z.email().max(255).optional()),
    display_name: blank(z.string().trim().max(100).optional()),
  }),

  // Vincular convidado a conta: só o e-mail, e ele precisa ser de uma conta que
  // já existe — não se cria usuário por este caminho.
  // O nome da badge é dado do organizador, não rótulo do sistema — não é
  // traduzido e vai como veio, só aparado e limitado ao que a coluna aguenta.
  createBadge: z.object({
    name: z.string().trim().min(2).max(60),
  }),

  updateBadge: z.object({
    name: blank(z.string().trim().min(2).max(60).optional()),
  }),

  awardBadge: z.object({
    email: z.email().max(255),
  }),

  badgeVisibility: z.object({
    visible: boolish,
  }),

  profileVisibility: z.object({
    profile_public: boolish,
  }),

  linkPlayer: z.object({
    email: z.email().max(255),
  }),

  updatePlayer: z.object({
    deck_name: z.string().max(100).optional(),
    status: z.enum(PLAYER_STATUSES).optional(),
  }),

  swapPlayers: z.object({
    player1Id: z.string().min(1).max(36),
    player2Id: z.string().min(1).max(36),
  }),

  // p1_games/p2_games são opcionais e só fazem sentido em mesa 1v1: alimentam
  // GW% e OGW% sem alterar quem venceu a partida, que continua vindo de `result`.
  submitResult: z.object({
    result: z.enum(RESULTS),
    p1_games: int(0, 9),
    p2_games: int(0, 9),
  }),

  // Clã Fronto: o clã entra inteiro ou não entra. Ou quatro e-mails de contas
  // existentes (inscrição do próprio jogador), ou quatro nomes (convidados do dono).
  createClan: z.object({
    name: z.string().trim().min(2).max(60),
    emails: z.array(z.email().max(255)).length(4).optional(),
    display_names: z.array(z.string().trim().min(1).max(100)).length(4).optional(),
  }).refine(
    (v) => Boolean(v.emails) !== Boolean(v.display_names),
    { message: 'Informe quatro e-mails ou quatro nomes de convidado, n\u00e3o os dois' }
  ),

  createLeague: z.object({
    name: z.string().trim().min(1).max(100),
    playoff_counts: boolish,
  }),

  updateLeague: z.object({
    name: blank(z.string().trim().min(1).max(100).optional()),
    playoff_counts: boolish,
  }),
};

module.exports = schemas;
