const jwt = require('jsonwebtoken');
const db = require('../db');

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    // A structurally valid token can still reference a user that no longer exists
    // (deleted account, or a token issued against a database that's since been reset).
    // Catching that here avoids raw FK-constraint errors leaking from downstream routes.
    const user = await db.get('SELECT id FROM users WHERE id = ?', [decoded.id]);
    if (!user) return res.status(401).json({ error: 'Session no longer valid, please log in again' });
    req.user = decoded;
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
}

module.exports = authMiddleware;
