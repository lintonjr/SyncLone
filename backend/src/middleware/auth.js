const jwt = require('jsonwebtoken');
const db = require('../db');
const { HttpError, asyncHandler } = require('../lib/http');

const authMiddleware = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'No token provided', 'api.noToken');
  }
  const token = header.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Invalid or expired token', 'api.badToken');
  }

  // A structurally valid token can still reference a user that no longer exists
  // (deleted account, or a token issued against a database that's since been reset).
  // Catching that here avoids raw FK-constraint errors leaking from downstream routes.
  const user = await db.get('SELECT id, role FROM users WHERE id = ?', [decoded.id]);
  if (!user) throw new HttpError(401, 'Session no longer valid, please log in again', 'api.sessionExpired');

  // O papel vem do banco, não do token. O token dura sete dias; desde que
  // organizar passou a depender de aprovação, o papel muda no meio da validade
  // dele — nos dois sentidos. Lendo do banco, a aprovação vale no próximo
  // clique e a revogação também: um organizador rebaixado não continua criando
  // eventos por uma semana só porque o crachá no bolso ainda diz o contrário.
  // O token segue respondendo quem é a pessoa; o que ela pode fazer é do banco.
  req.user = { ...decoded, role: user.role };
  next();
});

module.exports = authMiddleware;
