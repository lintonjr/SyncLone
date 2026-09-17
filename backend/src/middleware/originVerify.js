const crypto = require('crypto');

/** O header que só a distribuição CloudFront injeta. */
const HEADER = 'x-origin-verify';

/**
 * Caminhos que não passam pela verificação.
 *
 * O health check do container roda de dentro da própria task, sem CloudFront no
 * meio: exigir o header dele faria o ECS reiniciar uma task saudável em loop.
 */
const ISENTOS = new Set(['/api/health']);

const resumo = (valor) => crypto.createHash('sha256').update(String(valor ?? ''), 'utf8').digest();

/**
 * Confere um valor recebido contra os resumos aceitos, em tempo constante.
 *
 * Comparar os resumos SHA-256, e não os textos, é o que dá buffers de tamanho
 * igual ao `timingSafeEqual` — que lança erro com tamanhos diferentes e, pior,
 * deixaria o tamanho do segredo observável. E todos os candidatos são
 * comparados, sem sair no primeiro acerto: o tempo não diz qual deles bateu.
 */
function origemConfere(valor, resumosAceitos) {
  const recebido = resumo(valor);
  let confere = false;
  for (const aceito of resumosAceitos) {
    confere = crypto.timingSafeEqual(recebido, aceito) || confere;
  }
  return confere;
}

/**
 * Recusa o que não veio pela nossa distribuição CloudFront.
 *
 * O security group da task já só aceita as bordas do CloudFront, mas isso inclui
 * a distribuição de **qualquer** conta AWS: alguém pode apontar a própria
 * distribuição para o IP da task e chegar aqui por ela. O header secreto é o que
 * separa a nossa das outras. Sem esta verificação, aquela proteção de rede era a
 * única camada — e ela não fecha essa porta.
 *
 * Sem segredos configurados, não faz nada (Docker local).
 *
 * A resposta é um 403 sem explicação, e o log não guarda o valor recebido: quem
 * está sondando não aprende nada, e o log não vira lugar de vazar tentativa de
 * segredo.
 */
function criarOriginVerify(segredos, { log = console } = {}) {
  if (!segredos.length) return (req, res, next) => next();

  const resumosAceitos = segredos.map(resumo);

  return (req, res, next) => {
    if (ISENTOS.has(req.path)) return next();
    if (origemConfere(req.get(HEADER), resumosAceitos)) return next();

    log.warn(`[origem] recusado ${req.method} ${req.path} de ${req.socket?.remoteAddress ?? '?'}`);
    res.status(403).json({ error: 'Forbidden', code: 'api.forbidden' });
  };
}

module.exports = { criarOriginVerify, origemConfere, HEADER, ISENTOS };
