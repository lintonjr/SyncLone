const { HttpError } = require('../lib/http');
const { podeAvaliar } = require('../lib/avaliacao');

/**
 * Quem cuida das avaliações: o dono da plataforma e quem tem a marca de
 * avaliador na conta.
 *
 * A marca é permissão e não papel — o funcionário que avalia coleção no balcão
 * costuma ser o mesmo que organiza o torneio de sexta, e `users.role` é
 * excludente. Por isso `req.user.avaliador` vem do banco a cada requisição, como
 * o papel: tirar a permissão de alguém vale no clique seguinte, não quando o
 * token dele vencer.
 */
function requireAvaliador(req, res, next) {
  if (!podeAvaliar(req.user)) {
    throw new HttpError(403, 'Only appraisers can perform this action', 'api.avaliadorOnly');
  }
  next();
}

module.exports = requireAvaliador;
