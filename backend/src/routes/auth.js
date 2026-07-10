const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

router.post('/register', (req, res) => {
  const { display_name, email, password } = req.body;
  if (!display_name || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const password_hash = bcrypt.hashSync(password, 10);
  const id = uuidv4();
  db.prepare('INSERT INTO users (id, display_name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run(id, display_name, email, password_hash);

  const token = jwt.sign({ id, email, display_name }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
  res.status(201).json({ token, user: { id, display_name, email } });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, display_name: user.display_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
  res.json({ token, user: { id: user.id, display_name: user.display_name, email: user.email } });
});

router.post('/forgot-password', (req, res) => {
  // In production, send reset email. Here just acknowledge.
  res.json({ message: 'If that email exists, a reset link was sent.' });
});

module.exports = router;
