const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { HttpError, asyncHandler } = require('../lib/http');
const { notifyUsers } = require('../services/notify');
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
      await tx.run("UPDATE users SET role = 'organizer' WHERE id = ? AND role = 'player'", [pedido.user_id]);
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
 * Quem tem poder na plataforma hoje.
 *
 * Só organizadores e admins: a lista existe para revogar e promover, e os 276
 * players não têm o que ser revogado. Quem quiser ver um jogador específico tem a
 * página de perfil dele.
 */
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
