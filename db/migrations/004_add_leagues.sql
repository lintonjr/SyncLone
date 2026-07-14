CREATE TABLE IF NOT EXISTS leagues (
  id varchar(36) NOT NULL,
  name varchar(100) NOT NULL,
  owner_id varchar(36) NOT NULL,
  playoff_counts tinyint(1) NOT NULL DEFAULT 1,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY owner_id (owner_id),
  CONSTRAINT leagues_ibfk_1 FOREIGN KEY (owner_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE events
  ADD COLUMN league_id varchar(36) DEFAULT NULL AFTER qr_code_enabled,
  ADD KEY league_id (league_id),
  ADD CONSTRAINT events_league_fk FOREIGN KEY (league_id) REFERENCES leagues (id) ON DELETE SET NULL;
