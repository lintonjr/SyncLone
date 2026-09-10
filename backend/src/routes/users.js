const router = require('express').Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const auth = require('../middleware/auth');
const { HttpError, asyncHandler } = require('../lib/http');

router.get('/me', auth, asyncHandler(async (req, res) => {
  const user = await db.get('SELECT id, display_name, email, role FROM users WHERE id = ?', [req.user.id]);
  if (!user) throw new HttpError(404, 'User not found');
  res.json(user);
}));

router.post('/me/upgrade-to-organizer', auth, asyncHandler(async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) throw new HttpError(404, 'User not found');

  if (user.role !== 'organizer') {
    await db.run("UPDATE users SET role = 'organizer' WHERE id = ?", [user.id]);
    user.role = 'organizer';
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
  res.json({ token, user: { id: user.id, display_name: user.display_name, email: user.email, role: user.role } });
}));

module.exports = router;
