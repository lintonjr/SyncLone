const { podeOrganizar } = require('../lib/roles');

function requireOrganizer(req, res, next) {
  // Admin entra por aqui também: os papéis são excludentes na coluna, mas a
  // permissão é hierárquica. A regra mora em lib/roles.js, que é onde ela é
  // testada.
  if (!podeOrganizar(req.user?.role)) {
    return res.status(403).json({ error: 'Only organizers can perform this action' });
  }
  next();
}

module.exports = requireOrganizer;
