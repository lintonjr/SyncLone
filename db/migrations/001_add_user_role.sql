-- Adds role support to users; backfills organizer role for existing event owners.

ALTER TABLE users
  ADD COLUMN role ENUM('player','organizer') NOT NULL DEFAULT 'player' AFTER password_hash;

UPDATE users u
SET u.role = 'organizer'
WHERE EXISTS (SELECT 1 FROM events e WHERE e.owner_id = u.id);
