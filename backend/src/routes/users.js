const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const { HttpError, asyncHandler } = require('../lib/http');
const { computeStandings } = require('../services/standings');
const { notifyUsers, adminUserIds } = require('../services/notify');
const { podePedirParaOrganizar } = require('../lib/roles');
const validate = require('../middleware/validate');
const schemas = require('../schemas');

router.get('/me', auth, asyncHandler(async (req, res) => {
  const user = await db.get('SELECT id, display_name, email, role, profile_public FROM users WHERE id = ?', [req.user.id]);
  if (!user) throw new HttpError(404, 'User not found', 'api.userNotFound');
  res.json(user);
}));

/**
 * Pedir para organizar.
 *
 * Substituiu o antigo `upgrade-to-organizer`, que promovia na hora: organizar
 * deixou de ser self-service e passou a depender do dono da plataforma. Note que
 * esta rota **não** devolve token novo — antes devolvia, porque o papel mudava
 * ali mesmo. Agora nada muda até alguém decidir, e quando mudar o papel já vem do
 * banco a cada requisição (middleware/auth.js): ninguém precisa relogar.
 */
router.post('/me/organizer-request', auth, validate(schemas.organizerRequest), asyncHandler(async (req, res) => {
  const user = await db.get('SELECT id, display_name, role FROM users WHERE id = ?', [req.user.id]);
  if (!user) throw new HttpError(404, 'User not found', 'api.userNotFound');
  if (!podePedirParaOrganizar(user.role)) {
    throw new HttpError(409, 'You can already organize events', 'api.alreadyOrganizer');
  }

  const id = uuidv4();
  const justification = req.body.justification ?? null;

  try {
    await db.transaction(async (tx) => {
      await tx.run(
        'INSERT INTO organizer_requests (id, user_id, justification) VALUES (?, ?, ?)',
        [id, user.id, justification]
      );
      // O dono não fica sabendo por acaso: o pedido chega na caixa dele como
      // qualquer outro aviso do sistema.
      await notifyUsers(tx, await adminUserIds(tx), 'notif.organizerRequested', { nome: user.display_name });
    });
  } catch (err) {
    // O índice único é quem garante um pendente por pessoa — duas abas clicando
    // ao mesmo tempo esbarram aqui, e não em duas linhas na fila.
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'You already have a request awaiting review', 'api.requestPending');
    }
    throw err;
  }

  res.status(201).json(await meuPedido(req.user.id));
}));

/**
 * O meu pedido mais recente, com o desfecho.
 *
 * A tela de conta precisa dos três estados: nunca pedi (null), estou na fila, ou
 * fui recusado — e neste último o motivo, que é o que torna a recusa uma resposta
 * e não um silêncio.
 */
router.get('/me/organizer-request', auth, asyncHandler(async (req, res) => {
  res.json(await meuPedido(req.user.id));
}));

function meuPedido(userId) {
  return db.get(
    `SELECT r.id, r.status, r.justification, r.reason, r.created_at, r.decided_at,
            u.display_name AS decided_by_name
     FROM organizer_requests r
     LEFT JOIN users u ON u.id = r.decided_by
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC LIMIT 1`,
    [userId]
  );
}

/**
 * Liga e desliga a visibilidade do próprio perfil.
 *
 * Só o titular muda a própria preferência — não há caminho para um organizador
 * ou outro jogador alterá-la.
 */
router.put('/me/profile-visibility', auth, validate(schemas.profileVisibility), asyncHandler(async (req, res) => {
  const publico = req.body.profile_public ? 1 : 0;
  await db.run('UPDATE users SET profile_public = ? WHERE id = ?', [publico, req.user.id]);
  res.json({ profile_public: publico });
}));

/**
 * As minhas badges, inclusive as que escondi.
 *
 * O perfil público mostra só as visíveis; esta rota mostra todas, porque é dela
 * que sai a lista onde o jogador liga e desliga cada uma.
 */
router.get('/me/badges', auth, asyncHandler(async (req, res) => {
  res.json(await badgesDe(db, req.user.id, { incluirEscondidas: true }));
}));

/**
 * O jogador decide quais badges aparecem no seu perfil.
 *
 * Quem entregou não manda nisto: a badge é reconhecimento de quem a deu, mas a
 * página é da pessoa. Esconder não devolve a badge — ela continua entregue, e
 * volta a aparecer no dia em que ela quiser.
 */
router.put('/me/badges/:id', auth, validate(schemas.badgeVisibility), asyncHandler(async (req, res) => {
  const entrega = await db.get('SELECT * FROM user_badges WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]);
  if (!entrega) throw new HttpError(404, 'Badge não encontrada', 'api.badgeNotFound');

  const visivel = req.body.visible ? 1 : 0;
  await db.run('UPDATE user_badges SET visible = ? WHERE id = ?', [visivel, entrega.id]);
  res.json({ id: entrega.id, visible: visivel });
}));

/**
 * Perfil público de um jogador.
 *
 * Pública de propósito, sem autenticação: tudo o que ela mostra já é público na
 * classificação de qualquer evento — nome, retrospecto, colocação. O que nunca
 * sai daqui é o e-mail, que é o único dado da conta que não está em lugar
 * nenhum visível.
 *
 * O retrospecto é recalculado das mesas, não lido de coluna: é a mesma fonte que
 * alimenta a tabela de cada evento, então perfil e classificação não têm como
 * discordar.
 */
router.get('/:id/profile', optionalAuth, asyncHandler(async (req, res) => {
  const user = await db.get(
    'SELECT id, display_name, role, profile_public, created_at FROM users WHERE id = ?',
    [req.params.id]
  );
  if (!user) throw new HttpError(404, 'User not found', 'api.userNotFound');

  // Perfil fechado responde 403, não 404: dizer "não existe" para alguém que
  // existe seria mentir, e a tela precisa saber a diferença entre um endereço
  // errado e uma escolha da pessoa. O próprio titular continua vendo o seu.
  if (!user.profile_public && req.user?.id !== user.id) {
    throw new HttpError(403, 'Este jogador optou por manter o perfil privado', 'api.profilePrivate');
  }

  // Uma consulta traz as inscrições da pessoa com o evento de cada uma; duas
  // trazem, de uma vez, todos os jogadores e todas as mesas desses eventos —
  // que é o que `computeStandings` precisa para recalcular cada torneio. Sem
  // isso viraria uma ida ao banco por evento jogado.
  const inscricoes = await db.query(
    `SELECT ep.id, ep.event_id, ep.deck_name, ep.status,
            e.name AS event_name, e.date, e.timezone, e.game, e.format, e.status AS event_status,
            e.points_win, e.points_draw, e.points_loss, e.champion_id,
            e.league_id, l.name AS league_name
     FROM event_players ep
     JOIN events e ON e.id = ep.event_id
     LEFT JOIN leagues l ON l.id = e.league_id
     WHERE ep.user_id = ?
     ORDER BY e.date DESC`,
    [req.params.id]
  );

  // O titular vê as suas escondidas também, marcadas — é no próprio perfil que
  // ele liga e desliga cada uma, e não faria sentido esconder dele o que escondeu.
  const souEu = req.user?.id === user.id;
  const badges = await badgesDe(db, user.id, { incluirEscondidas: souEu });

  if (inscricoes.length === 0) {
    return res.json({ user, totals: vazio(), by_league: [], events: [], badges });
  }

  const eventIds = [...new Set(inscricoes.map((i) => i.event_id))];
  const marcadores = eventIds.map(() => '?').join(',');
  const [todosJogadores, todasMesas] = await Promise.all([
    db.query(`SELECT * FROM event_players WHERE event_id IN (${marcadores})`, eventIds),
    db.query(
      `SELECT p.*, r.is_playoff FROM pairings p
       JOIN rounds r ON r.id = p.round_id
       WHERE p.event_id IN (${marcadores})`,
      eventIds
    ),
  ]);

  const porEvento = (linhas) => {
    const mapa = new Map(eventIds.map((id) => [id, []]));
    for (const l of linhas) mapa.get(l.event_id)?.push(l);
    return mapa;
  };
  const jogadoresDe = porEvento(todosJogadores);
  const mesasDe = porEvento(todasMesas);

  const eventos = inscricoes.map((i) => {
    const ranked = computeStandings(jogadoresDe.get(i.event_id) ?? [], mesasDe.get(i.event_id) ?? [], i);
    const ativos = ranked.filter((p) => p.status === 'active');
    const eu = ranked.find((p) => p.id === i.id);
    return {
      event_id: i.event_id,
      name: i.event_name,
      date: i.date,
      game: i.game,
      format: i.format,
      event_status: i.event_status,
      league_id: i.league_id,
      league_name: i.league_name,
      deck_name: i.deck_name,
      dropped: i.status !== 'active',
      champion: i.champion_id === i.id,
      // A colocação só faz sentido entre quem ficou até o fim.
      position: i.status === 'active' ? ativos.findIndex((p) => p.id === i.id) + 1 : null,
      field_size: ativos.length,
      wins: eu?.wins ?? 0,
      losses: eu?.losses ?? 0,
      draws: eu?.draws ?? 0,
      points: eu?.points ?? 0,
    };
  });

  // O recorte usa exatamente a mesma conta do total geral: uma função só,
  // aplicada a listas diferentes. Duas fórmulas para o mesmo número é o defeito
  // que este sistema já pagou caro para aprender.
  const totals = somar(eventos);

  // Um jogador não quer ver o aproveitamento da liga que ele leva a sério
  // diluído pelos eventos soltos de sábado à tarde. Cada recorte é uma liga de
  // que ele participou — as que ele nunca jogou não existem aqui.
  //
  // Os eventos fora de liga viram um grupo próprio. Sem ele, quem tem 8 etapas e
  // 3 eventos avulsos veria "Geral 11" com as fichas somando 8 — e um número que
  // não reconcilia é a classe de defeito que este projeto já pagou três vezes.
  const AVULSOS = '\u0000avulsos';
  const grupos = new Map();
  for (const e of eventos) {
    const chave = e.league_id ?? AVULSOS;
    if (!grupos.has(chave)) {
      grupos.set(chave, { league_id: e.league_id ?? null, name: e.league_name ?? null, eventos: [] });
    }
    grupos.get(chave).eventos.push(e);
  }

  const by_league = [...grupos.values()]
    .map((g) => ({
      key: g.league_id ?? 'avulsos',
      league_id: g.league_id,
      // Nulo quando é o grupo dos avulsos: ele não tem nome próprio, e quem o
      // rotula é a tela — o nome de uma liga é dado, "Avulsos" é rótulo.
      name: g.name,
      ...somar(g.eventos),
    }))
    .sort((a, b) => {
      // Avulsos sempre por último: não é uma liga, é o resto.
      if (!a.league_id) return 1;
      if (!b.league_id) return -1;
      // Mais jogada primeiro — é o recorte que define a pessoa. O nome desempata,
      // para a ordem não mudar entre duas visitas à mesma página.
      return b.events - a.events || a.name.localeCompare(b.name);
    });

  res.json({ user, totals, by_league, events: eventos, badges });
}));

/**
 * As badges de um jogador, da mais recente para a mais antiga.
 *
 * `incluirEscondidas` separa as duas leituras que existem: o visitante vê o que
 * a pessoa escolheu mostrar, e a própria pessoa vê tudo.
 */
function badgesDe(conn, userId, { incluirEscondidas }) {
  return conn.query(
    `SELECT ub.id, ub.visible, ub.awarded_at, b.id AS badge_id, b.name, b.image,
            u.display_name AS awarded_by_name
     FROM user_badges ub
     JOIN badges b ON b.id = ub.badge_id
     JOIN users u ON u.id = b.owner_id
     WHERE ub.user_id = ?${incluirEscondidas ? '' : ' AND ub.visible = 1'}
     ORDER BY ub.awarded_at DESC`,
    [userId]
  );
}

/**
 * O retrospecto de um conjunto de participações.
 *
 * Serve tanto ao total geral quanto a cada recorte por jogo/formato — é a mesma
 * pergunta feita sobre listas diferentes.
 */
function somar(eventos) {
  const soma = (campo) => eventos.reduce((t, e) => t + e[campo], 0);
  const partidas = soma('wins') + soma('losses') + soma('draws');
  return {
    events: eventos.length,
    wins: soma('wins'),
    losses: soma('losses'),
    draws: soma('draws'),
    matches: partidas,
    // Aproveitamento no estilo MTR: empate vale meia vitória. `null` quando a
    // pessoa ainda não jogou nada, para a tela mostrar "—" em vez de 0%.
    win_rate: partidas ? (soma('wins') + soma('draws') / 2) / partidas : null,
    titles: eventos.filter((e) => e.champion).length,
  };
}

function vazio() {
  return somar([]);
}

module.exports = router;
