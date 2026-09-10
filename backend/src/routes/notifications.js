const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');

router.get('/', auth, asyncHandler(async (req, res) => {
  const notes = await db.query(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  );
  res.json(notes);
}));

router.put('/read-all', auth, asyncHandler(async (req, res) => {
  await db.run('UPDATE notifications SET `read` = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ message: 'All marked as read' });
}));

router.put('/:id/read', auth, asyncHandler(async (req, res) => {
  await db.run('UPDATE notifications SET `read` = 1 WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]);
  res.json({ message: 'Marked as read' });
}));

module.exports = router;
