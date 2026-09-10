const jwt = require('jsonwebtoken');
const { asyncHandler } = require('../lib/http');

/**
 * Autenticação opcional: identifica quem está chamando, sem exigir que alguém
 * esteja.
 *
 * Existe para rotas que são públicas mas mudam de resposta quando quem pede é o
 * próprio dono do dado — o caso concreto é o perfil marcado como privado, que o
 * seu titular continua enxergando. Um token inválido ou expirado é tratado como
 * ausência de token, e não como erro: a rota é pública, e quebrar a visita de
 * quem tem um token velho no navegador seria pior que ignorá-lo.
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    } catch {
      // segue anônimo
    }
  }
  next();
});

module.exports = optionalAuth;
