/**
 * Small helpers shared by every route so that error handling lives in one place.
 *
 * `HttpError` carries a status the central error handler is allowed to expose to
 * the client; anything else that reaches the handler is treated as internal and
 * answered with a generic message (an internal error's own text can leak schema
 * details — see the "Data too long for column ..." class of MySQL errors).
 *
 * `asyncHandler` forwards a rejected promise to `next`, which is what lets the
 * routes drop their per-handler try/catch blocks.
 */
/**
 * `code` e `params` existem para o cliente poder traduzir.
 *
 * Enquanto a API mandava só a frase pronta, metade do que o usuário lia vinha
 * em inglês e metade em português, e nenhum mecanismo de i18n do frontend
 * alcançava isso — a frase já chegava escolhida. Com um código, quem decide o
 * idioma é a tela.
 *
 * `message` continua sendo enviado junto: é o que aparece quando o código ainda
 * não tem tradução, e é o que mantém a migração incremental em vez de exigir
 * converter as 80 mensagens de uma vez.
 */
class HttpError extends Error {
  constructor(status, message, code = null, params = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.expose = true;
    this.code = code;
    this.params = params;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, asyncHandler };
