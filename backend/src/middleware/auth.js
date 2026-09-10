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
  const user = await db.get('SELECT id FROM users WHERE id = ?', [decoded.id]);
  if (!user) throw new HttpError(401, 'Session no longer valid, please log in again', 'api.sessionExpired');
  req.user = decoded;
  next();
});

module.exports = authMiddleware;
