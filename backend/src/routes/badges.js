const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');
const requireOrganizer = require('../middleware/requireOrganizer');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { HttpError, asyncHandler } = require('../lib/http');
const { imageUpload, publicPath, removeFile } = require('../lib/uploads');
const { notifyUsers } = require('../services/notify');

// Uma badge é um ícone exibido a 20px ao lado de um nome. O limite de 5 MB das
// capas de evento aqui só serviria para alguém subir uma foto de câmera por
// engano e o navegador de todo mundo baixá-la para desenhar um quadradinho.
const upload = imageUpload({
  maxBytes: 512 * 1024,
  mensagem: 'A imagem da badge precisa ser PNG, JPEG, WebP ou GIF, com até 512 KB',
});

/** A badge existe e é de quem está chamando — a única forma de mexer nela. */
async function minhaBadge(conn, badgeId, userId) {
  const badge = await conn.get('SELECT * FROM badges WHERE id = ?', [badgeId]);
  if (!badge) throw new HttpError(404, 'Badge não encontrada', 'api.badgeNotFound');
  // Só quem criou entrega e edita: é o que mantém a badge com dono claro, em vez
  // de virar um símbolo que três lojas usam sem saber uma da outra.
  if (badge.owner_id !== userId) throw new HttpError(403, 'Forbidden', 'api.forbidden');
  return badge;
}

// Organizador: as badges que ele criou, com quantas vezes já foram entregues.
router.get('/', auth, requireOrganizer, asyncHandler(async (req, res) => {
  const badges = await db.query(
    `SELECT b.*, (SELECT COUNT(*) FROM user_badges ub WHERE ub.badge_id = b.id) AS awarded_count
     FROM badges b WHERE b.owner_id = ? ORDER BY b.created_at DESC`,
    [req.user.id]
  );
  res.json(badges);
}));

// Organizador: quem já recebeu uma badge específica.
router.get('/:id/awards', auth, requireOrganizer, asyncHandler(async (req, res) => {
  await minhaBadge(db, req.params.id, req.user.id);
  const recebedores = await db.query(
    `SELECT ub.id, ub.user_id, ub.visible, ub.awarded_at, u.display_name
     FROM user_badges ub JOIN users u ON u.id = ub.user_id
     WHERE ub.badge_id = ? ORDER BY ub.awarded_at DESC`,
    [req.params.id]
  );
  res.json(recebedores);
}));

router.post('/', auth, requireOrganizer, upload.single('image'), validate(schemas.createBadge),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'A badge precisa de uma imagem', 'api.badgeImageRequired');

    const existe = await db.get('SELECT id FROM badges WHERE owner_id = ? AND name = ?',
      [req.user.id, req.body.name]);
    if (existe) {
      await removeFile(publicPath(req.file));
      throw new HttpError(409, `Você já tem uma badge chamada ${req.body.name}`, 'api.badgeNameTaken');
    }

    const id = uuidv4();
    await db.run('INSERT INTO badges (id, owner_id, name, image) VALUES (?, ?, ?, ?)',
      [id, req.user.id, req.body.name, publicPath(req.file)]);
    res.status(201).json(await db.get('SELECT * FROM badges WHERE id = ?', [id]));
  }));

// Editar continua livre mesmo depois de entregue: quem errou a imagem precisa
// poder corrigir, e a correção aparece para todo mundo que já a recebeu.
router.put('/:id', auth, requireOrganizer, upload.single('image'), validate(schemas.updateBadge),
  asyncHandler(async (req, res) => {
    const badge = await minhaBadge(db, req.params.id, req.user.id);
    const nome = req.body.name ?? badge.name;

    if (nome !== badge.name) {
      const existe = await db.get('SELECT id FROM badges WHERE owner_id = ? AND name = ? AND id <> ?',
        [req.user.id, nome, req.params.id]);
      if (existe) throw new HttpError(409, `Você já tem uma badge chamada ${nome}`, 'api.badgeNameTaken');
    }

    const imagem = publicPath(req.file) ?? badge.image;
    await db.run('UPDATE badges SET name = ?, image = ? WHERE id = ?', [nome, imagem, req.params.id]);
    // A imagem antiga vira lixo em disco no instante em que ninguém mais a referencia.
    if (req.file) await removeFile(badge.image);
    res.json(await db.get('SELECT * FROM badges WHERE id = ?', [req.params.id]));
  }));

/**
 * Apagar só vale para badge que ninguém recebeu.
 *
 * Sumir com a conquista de dez pessoas porque alguém arrumou o próprio menu é
 * dano que não se desfaz. Para tirar de alguém, revoga-se a entrega.
 */
router.delete('/:id', auth, requireOrganizer, asyncHandler(async (req, res) => {
  const badge = await minhaBadge(db, req.params.id, req.user.id);
  const entregue = await db.get('SELECT id FROM user_badges WHERE badge_id = ? LIMIT 1', [req.params.id]);
  if (entregue) {
    throw new HttpError(409, 'Esta badge já foi entregue: revogue as entregas antes de apagá-la',
      'api.badgeInUse');
  }
  await db.run('DELETE FROM badges WHERE id = ?', [req.params.id]);
  await removeFile(badge.image);
  res.json({ message: 'Badge removida' });
}));

/**
 * Entrega a badge a um jogador, pelo e-mail da conta.
 *
 * Por e-mail porque o sistema não tem — e não deveria ter — busca de usuários:
 * uma lista de contas consultável expõe a base inteira para resolver um problema
 * que o organizador já resolve sabendo a quem está entregando.
 *
 * Convidado não recebe: sem conta não há perfil onde a badge apareça. Quem
 * precisa premiar um convidado vincula a inscrição dele a uma conta primeiro.
 */
router.post('/:id/award', auth, requireOrganizer, validate(schemas.awardBadge),
  asyncHandler(async (req, res) => {
    const badge = await minhaBadge(db, req.params.id, req.user.id);

    const user = await db.get('SELECT id, display_name FROM users WHERE email = ?', [req.body.email]);
    if (!user) throw new HttpError(404, 'User not found with that email', 'api.userNotFound');

    // A chave única do banco também barra, mas um 409 explicando é melhor que um
    // erro de driver traduzido.
    const jaTem = await db.get('SELECT id FROM user_badges WHERE badge_id = ? AND user_id = ?',
      [req.params.id, user.id]);
    if (jaTem) throw new HttpError(409, `${user.display_name} já tem esta badge`, 'api.badgeAlreadyAwarded');

    const id = uuidv4();
    await db.run('INSERT INTO user_badges (id, badge_id, user_id, awarded_by) VALUES (?, ?, ?, ?)',
      [id, req.params.id, user.id, req.user.id]);
    await notifyUsers(db, [user.id], 'notif.badgeAwarded', { badge: badge.name });

    res.status(201).json(await db.get(
      `SELECT ub.id, ub.user_id, ub.visible, ub.awarded_at, u.display_name
       FROM user_badges ub JOIN users u ON u.id = ub.user_id WHERE ub.id = ?`, [id]));
  }));

router.delete('/:id/award/:userId', auth, requireOrganizer, asyncHandler(async (req, res) => {
  await minhaBadge(db, req.params.id, req.user.id);
  const entrega = await db.get('SELECT id FROM user_badges WHERE badge_id = ? AND user_id = ?',
    [req.params.id, req.params.userId]);
  if (!entrega) throw new HttpError(404, 'Entrega não encontrada', 'api.awardNotFound');

  await db.run('DELETE FROM user_badges WHERE id = ?', [entrega.id]);
  res.json({ message: 'Entrega revogada' });
}));

module.exports = router;
