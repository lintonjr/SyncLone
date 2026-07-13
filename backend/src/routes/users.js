const router = require('express').Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/me', auth, async (req, res) => {
  try {
    const user = await db.get('SELECT id, display_name, email, role FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/me/upgrade-to-organizer', auth, async (req, res) => {
  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
