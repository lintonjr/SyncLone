const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('../db');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { HttpError, asyncHandler } = require('../lib/http');

// Credential endpoints are the brute-force surface, and bcrypt makes each attempt
// expensive for us too — so the limit is per IP *and* per targeted account: one
// attacker can't spend another user's budget, and spraying many accounts from one
// address still trips the IP half of the key.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email ?? '').toLowerCase()}`,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

router.post('/register', credentialLimiter, validate(schemas.register), asyncHandler(async (req, res) => {
  const { display_name, email, password } = req.body;

  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) throw new HttpError(409, 'Email already in use', 'api.emailInUse');

  const password_hash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  await db.run('INSERT INTO users (id, display_name, email, password_hash) VALUES (?, ?, ?, ?)',
    [id, display_name, email, password_hash]);

  const role = 'player';
  const token = jwt.sign({ id, email, display_name, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
  res.status(201).json({ token, user: { id, display_name, email, role } });
}));

router.post('/login', credentialLimiter, validate(schemas.login), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    throw new HttpError(401, 'Invalid credentials', 'api.invalidCredentials');

  const token = jwt.sign(
    { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
  res.json({ token, user: { id: user.id, display_name: user.display_name, email: user.email, role: user.role } });
}));

router.post('/forgot-password', credentialLimiter, validate(schemas.forgotPassword), (req, res) => {
  res.json({ message: 'If that email exists, a reset link was sent.' });
});

module.exports = router;
