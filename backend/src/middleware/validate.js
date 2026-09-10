const { HttpError } = require('../lib/http');

// Validates (and normalizes) req.body against a zod schema before the handler runs.
// On multipart routes this must sit after multer, since that's what populates req.body.
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const [issue] = result.error.issues;
      const field = issue.path.join('.');
      return next(new HttpError(400, field ? `${field}: ${issue.message}` : issue.message));
    }
    req.body = result.data;
    next();
  };
}

module.exports = validate;
