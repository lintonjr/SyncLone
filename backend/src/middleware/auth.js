const jwt = require('jsonwebtoken');
const db = require('../db');
const { HttpError, asyncHandler } = require('../lib/http');
const { jwtSecret } = require('../lib/config');
const { contaAtiva } = require('../lib/contas');

const authMiddleware = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'No token provided', 'api.noToken');
  }
  const token = header.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, jwtSecret());
  } catch {
    throw new HttpError(401, 'Invalid or expired token', 'api.badToken');
  }

  // A structurally valid token can still reference a user that no longer exists
  // (deleted account, or a token issued against a database that's since been reset).
  // Catching that here avoids raw FK-constraint errors leaking from downstream routes.
  const user = await db.get(
    'SELECT id, role, avaliador, status, must_change_password FROM users WHERE id = ?',
    [decoded.id]
  );
  if (!user) throw new HttpError(401, 'Session no longer valid, please log in again', 'api.sessionExpired');
  // Desativar tem de valer no clique seguinte, como a revogação de papel: o token
  // dura sete dias, e uma conta bloqueada não pode seguir usando o crachá velho.
  if (!contaAtiva(user.status)) throw new HttpError(401, 'This account is disabled', 'api.contaDesativada');

  // O papel vem do banco, não do token. O token dura sete dias; desde que
  // organizar passou a depender de aprovação, o papel muda no meio da validade
  // dele — nos dois sentidos. Lendo do banco, a aprovação vale no próximo
  // clique e a revogação também: um organizador rebaixado não continua criando
  // eventos por uma semana só porque o crachá no bolso ainda diz o contrário.
  // O token segue respondendo quem é a pessoa; o que ela pode fazer é do banco.
  req.user = {
    ...decoded,
    role: user.role,
    // Permissão de avaliar vem junto e pela mesma razão: tirá-la vale agora.
    avaliador: !!user.avaliador,
    must_change_password: !!user.must_change_password,
  };
  next();
});

module.exports = authMiddleware;
