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
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.expose = true;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, asyncHandler };
