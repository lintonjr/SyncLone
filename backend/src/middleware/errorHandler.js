const multer = require('multer');
const { HttpError } = require('../lib/http');

// Central error handler. The only messages that reach the client are the ones we
// wrote ourselves (HttpError / multer's own upload limits); everything else is
// logged server-side and answered generically, so driver errors never leak the
// database schema to callers.
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    // `error` é a frase pronta (compatibilidade e fallback); `code`/`params`
    // são o que o cliente usa para traduzir. Enviar os dois é o que permite
    // converter as mensagens aos poucos sem quebrar nenhuma tela.
    const corpo = { error: err.message };
    if (err.code) corpo.code = err.code;
    if (err.params) corpo.params = err.params;
    return res.status(err.status).json(corpo);
  }

  if (err instanceof multer.MulterError) {
    const grande = err.code === 'LIMIT_FILE_SIZE';
    return res.status(400).json({
      error: grande ? 'Image must be 5MB or smaller' : 'Invalid file upload',
      code: grande ? 'api.uploadTooLarge' : 'api.uploadInvalid',
    });
  }

  console.error(`${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Internal server error', code: 'api.internal' });
}

module.exports = errorHandler;
