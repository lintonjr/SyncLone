function requireOrganizer(req, res, next) {
  if (req.user?.role !== 'organizer') {
    return res.status(403).json({ error: 'Only organizers can perform this action' });
  }
  next();
}

module.exports = requireOrganizer;
