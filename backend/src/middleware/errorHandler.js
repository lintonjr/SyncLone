const multer = require('multer');
const { HttpError } = require('../lib/http');

// Central error handler. The only messages that reach the client are the ones we
// wrote ourselves (HttpError / multer's own upload limits); everything else is
// logged server-side and answered generically, so driver errors never leak the
// database schema to callers.
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Image must be 5MB or smaller'
      : 'Invalid file upload';
    return res.status(400).json({ error: message });
  }

  console.error(`${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;
