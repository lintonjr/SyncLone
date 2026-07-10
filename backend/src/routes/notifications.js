const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const notes = await db.query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json(notes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/read-all', auth, async (req, res) => {
  try {
    await db.run('UPDATE notifications SET `read` = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ message: 'All marked as read' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/read', auth, async (req, res) => {
  try {
    await db.run('UPDATE notifications SET `read` = 1 WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]);
    res.json({ message: 'Marked as read' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
