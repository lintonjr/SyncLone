const { HttpError } = require('../lib/http');
const { ehAdmin } = require('../lib/roles');

/**
 * Só o dono da plataforma passa.
 *
 * Responde 403 com código traduzível, como o resto da API — a tela do organizador
 * que tropeçar numa rota de admin precisa dizer o que houve, não mostrar um
 * "Forbidden" cru.
 */
function requireAdmin(req, res, next) {
  if (!ehAdmin(req.user?.role)) {
    throw new HttpError(403, 'Only the platform owner can perform this action', 'api.adminOnly');
  }
  next();
}

module.exports = requireAdmin;
