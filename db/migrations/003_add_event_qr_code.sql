ALTER TABLE events
  ADD COLUMN qr_code_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER confirm_players;
