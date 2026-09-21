const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { HttpError, asyncHandler } = require('../lib/http');
const { notifyUsers } = require('../services/notify');
const { v4: uuidv4 } = require('uuid');
const { impedimentoParaDecidir, impedimentoParaTrocarPapel } = require('../lib/roles');

/**
 * A mesa do dono da plataforma.
 *
 * Tudo aqui passa por `requireAdmin`, aplicado no router inteiro em vez de rota a
 * rota: numa área em que **toda** rota é restrita, proteger uma por uma é abrir
 * espaço para a próxima nascer desprotegida.
 */
router.use(auth, requireAdmin);

/**
 * A fila, e o que já foi decidido.
 *
 * Pendentes primeiro e mais antigo no topo — a fila é do tipo que se atende pela
 * ordem de chegada, não pela mais recente. O histórico vem junto, limitado, porque
 * a pergunta "o que eu já respondi a essa pessoa" é a mesma tela.
 */
router.get('/organizer-requests', asyncHandler(async (req, res) => {
  const pedidos = await db.query(
    `SELECT r.id, r.status, r.justification, r.reason, r.created_at, r.decided_at,
            u.id AS user_id, u.display_name, u.email, u.role, u.created_at AS user_since,
            d.display_name AS decided_by_name,
            (SELECT COUNT(*) FROM event_players ep WHERE ep.user_id = u.id) AS events_played
     FROM organizer_requests r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN users d ON d.id = r.decided_by
     ORDER BY (r.status = 'pending') DESC,
              IF(r.status = 'pending', r.created_at, NULL) ASC,
              r.decided_at DESC
     LIMIT 200`
  );
  res.json(pedidos);
}));

router.post('/organizer-requests/:id/approve', validate(schemas.requestDecision),
  asyncHandler((req, res) => decidir(req, res, 'approved')));

router.post('/organizer-requests/:id/reject', validate(schemas.requestDecision),
  asyncHandler((req, res) => decidir(req, res, 'rejected')));

/**
 * Aprovar e recusar são a mesma operação com desfechos diferentes.
 *
 * Numa transação porque promover a conta e fechar o pedido é uma coisa só: um
 * organizador sem pedido aprovado, ou um pedido aprovado sem organizador, são os
 * dois estados que não podem existir.
 */
async function decidir(req, res, status) {
  const reason = req.body.reason ?? null;

  const resultado = await db.transaction(async (tx) => {
    // FOR UPDATE: duas abas do dono abertas na mesma fila não podem transformar
    // uma recusa já gravada numa aprovação — a segunda encontra o pedido já
    // decidido e para.
    const pedido = await tx.get('SELECT * FROM organizer_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    const impedimento = impedimentoParaDecidir(pedido);
    if (impedimento) {
      throw new HttpError(impedimento === 'api.requestNotFound' ? 404 : 409,
        'This request cannot be decided', impedimento);
    }

    await tx.run(
      'UPDATE organizer_requests SET status = ?, reason = ?, decided_by = ?, decided_at = NOW(3) WHERE id = ?',
      [status, reason, req.user.id, pedido.id]
    );

    if (status === 'approved') {
      // Só promove quem ainda é player: se a conta já virou organizador por outro
      // caminho, o pedido apenas se fecha — não há o que promover duas vezes.
      const promocao = await tx.run(
        "UPDATE users SET role = 'organizer' WHERE id = ? AND role = 'player'",
        [pedido.user_id]
      );
      // A aprovação também entra no histórico: quem olha a ficha da pessoa
      // precisa ver como ela virou organizadora, tenha sido pela fila ou pela
      // área de usuários.
      if (promocao.affectedRows) {
        await tx.run(
          'INSERT INTO role_changes (id, user_id, de, para, autor_id, motivo) VALUES (?, ?, ?, ?, ?, ?)',
          [uuidv4(), pedido.user_id, 'player', 'organizer', req.user.id, reason]
        );
      }
    }

    const codigo = status === 'approved'
      ? 'notif.organizerApproved'
      : (reason ? 'notif.organizerRejectedReason' : 'notif.organizerRejected');
    await notifyUsers(tx, [pedido.user_id], codigo, reason ? { motivo: reason } : null);

    return pedido.id;
  });

  res.json(await db.get(
    `SELECT r.id, r.status, r.reason, r.decided_at, u.display_name, u.email, u.role
     FROM organizer_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
    [resultado]
  ));
}

/**
 * A área de usuários: todo mundo, não só quem tem poder.
 *
 * Busca por nome ou e-mail e filtro por papel são feitos **no banco**, com
 * paginação: a lista cresce com a loja, e trazer centenas de contas para filtrar
 * no navegador seria lento hoje e inviável depois.
 *
 * Cada linha traz o contexto que a decisão pede — desde quando existe, quantos
 * eventos jogou, quantos criou e em quantas ligas está no time —, para o
 * administrador não precisar abrir cinco telas antes de promover alguém.
 */
const PAGINA = 25;
const MAX_PAGINA = 100;

router.get('/users', asyncHandler(async (req, res) => {
  const limite = Math.min(Math.max(parseInt(req.query.limit) || PAGINA, 1), MAX_PAGINA);
  const inicio = Math.max(parseInt(req.query.offset) || 0, 0);
  const busca = (req.query.q ?? '').trim();
  const papel = ['player', 'organizer', 'admin'].includes(req.query.role) ? req.query.role : null;

  const condicoes = [];
  const params = [];
  if (busca) {
    condicoes.push('(u.display_name LIKE ? OR u.email LIKE ?)');
    params.push(`%${busca}%`, `%${busca}%`);
  }
  if (papel) {
    condicoes.push('u.role = ?');
    params.push(papel);
  }
  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  const [linhas, total] = await Promise.all([
    db.query(
      `SELECT u.id, u.display_name, u.email, u.role, u.created_at,
              (SELECT COUNT(*) FROM event_players ep WHERE ep.user_id = u.id) AS events_played,
              (SELECT COUNT(*) FROM events e WHERE e.owner_id = u.id) AS events_owned,
              (SELECT COUNT(*) FROM leagues l WHERE l.owner_id = u.id) AS leagues_owned,
              (SELECT COUNT(*) FROM league_organizers lo WHERE lo.user_id = u.id) AS leagues_team
       FROM users u
       ${onde}
       ORDER BY FIELD(u.role, 'admin', 'organizer', 'player'), u.display_name
       LIMIT ${limite} OFFSET ${inicio}`,
      params
    ),
    db.get(`SELECT COUNT(*) AS n FROM users u ${onde}`, params),
  ]);

  res.json({ users: linhas, total: total.n, limit: limite, offset: inicio });
}));

/**
 * A ficha de uma pessoa: as ligas em que ela manda e o histórico do papel dela.
 *
 * As ligas vêm com o vínculo (dona ou time), porque as duas coisas se gerenciam
 * de formas diferentes — de dona ninguém a remove; do time, sim.
 */
router.get('/users/:id', asyncHandler(async (req, res) => {
  const usuario = await db.get(
    `SELECT u.id, u.display_name, u.email, u.role, u.created_at, u.profile_public,
            (SELECT COUNT(*) FROM event_players ep WHERE ep.user_id = u.id) AS events_played,
            (SELECT COUNT(*) FROM events e WHERE e.owner_id = u.id) AS events_owned
     FROM users u WHERE u.id = ?`,
    [req.params.id]
  );
  if (!usuario) throw new HttpError(404, 'User not found', 'api.userNotFound');

  const ligas = await db.query(
    `SELECT l.id, l.name, 'dona' AS vinculo FROM leagues l WHERE l.owner_id = ?
     UNION ALL
     SELECT l.id, l.name, 'time' AS vinculo
       FROM league_organizers lo JOIN leagues l ON l.id = lo.league_id
      WHERE lo.user_id = ?
     ORDER BY name`,
    [req.params.id, req.params.id]
  );

  const historico = await db.query(
    `SELECT rc.de, rc.para, rc.motivo, rc.created_at, a.display_name AS autor
       FROM role_changes rc LEFT JOIN users a ON a.id = rc.autor_id
      WHERE rc.user_id = ? ORDER BY rc.created_at DESC LIMIT 50`,
    [req.params.id]
  );

  res.json({ ...usuario, leagues: ligas, role_history: historico });
}));

/** Mantida para o quadro antigo; a área de usuários usa `/users?role=`. */
router.get('/staff', asyncHandler(async (req, res) => {
  const staff = await db.query(
    `SELECT u.id, u.display_name, u.email, u.role, u.created_at,
            (SELECT COUNT(*) FROM events e WHERE e.owner_id = u.id) AS events_owned
     FROM users u
     WHERE u.role IN ('organizer', 'admin')
     ORDER BY FIELD(u.role, 'admin', 'organizer'), u.display_name`
  );
  res.json(staff);
}));

/**
 * Promover ou rebaixar uma conta.
 *
 * Rebaixar não mexe nos eventos que a pessoa já organiza: eles continuam dela, com
 * o histórico e os jogadores intactos. O que ela perde é criar novos e mexer nos
 * que tem — e isso vale no clique seguinte, porque o papel é lido do banco a cada
 * requisição, não do token que ela carrega há seis dias.
 */
router.put('/users/:id/role', validate(schemas.changeRole), asyncHandler(async (req, res) => {
  const alvo = await db.get('SELECT id, display_name, email, role FROM users WHERE id = ?', [req.params.id]);
  if (!alvo) throw new HttpError(404, 'User not found', 'api.userNotFound');

  const impedimento = impedimentoParaTrocarPapel({
    alvoId: alvo.id,
    alvoPapel: alvo.role,
    autorId: req.user.id,
    novoPapel: req.body.role,
  });
  if (impedimento) throw new HttpError(400, 'This role change is not allowed', impedimento);

  const novo = req.body.role;
  await db.transaction(async (tx) => {
    await tx.run('UPDATE users SET role = ? WHERE id = ?', [novo, alvo.id]);

    // Quem mudou, de quê para quê e por quê. Sem isto, seis meses depois ninguém
    // responde "quem promoveu essa pessoa?" — e com mais de um administrador essa
    // é a primeira pergunta quando um acesso surpreende.
    await tx.run(
      'INSERT INTO role_changes (id, user_id, de, para, autor_id, motivo) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), alvo.id, alvo.role, novo, req.user.id, req.body.reason ?? null]
    );

    // A pessoa fica sabendo pelos dois lados: ganhar poder sem aviso confunde,
    // e perdê-lo sem aviso parece defeito do sistema na próxima vez que ela tenta
    // criar um evento.
    const codigo = novo === 'admin' ? 'notif.adminPromoted'
      : novo === 'organizer' ? 'notif.organizerApproved'
        : 'notif.organizerRevoked';
    await notifyUsers(tx, [alvo.id], codigo, null);
  });

  res.json({ ...alvo, role: novo });
}));

module.exports = router;
