-- ManaSync clone — schema inicial
-- Executado automaticamente pelo container MySQL na primeira subida
-- (montado em /docker-entrypoint-initdb.d)

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `users` (
  `id` varchar(36) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` text NOT NULL,
  `role` enum('player','organizer') NOT NULL DEFAULT 'player',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `leagues` (
  `id` varchar(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `owner_id` varchar(36) NOT NULL,
  `playoff_counts` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `owner_id` (`owner_id`),
  CONSTRAINT `leagues_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `events` (
  `id` varchar(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `city` varchar(100) DEFAULT NULL,
  `address` text,
  `online` tinyint(1) NOT NULL DEFAULT '0',
  `thumbnail` varchar(255) DEFAULT NULL,
  `date` datetime NOT NULL,
  `game` varchar(50) NOT NULL,
  `format` varchar(50) DEFAULT NULL,
  -- 'standard' ou 'clafronto' — ver db/migrations/007_cla_fronto.sql
  `tournament_format` varchar(30) NOT NULL DEFAULT 'standard',
  `pairing_method` varchar(50) NOT NULL DEFAULT 'swiss',
  `playoff_structure` varchar(50) NOT NULL DEFAULT 'none',
  `allow_byes` tinyint(1) NOT NULL DEFAULT '0',
  `test_event` tinyint(1) NOT NULL DEFAULT '0',
  `collaborative_deck` tinyint(1) NOT NULL DEFAULT '0',
  `async_draws` tinyint(1) NOT NULL DEFAULT '0',
  `confirm_players` tinyint(1) NOT NULL DEFAULT '0',
  `qr_code_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `league_id` varchar(36) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'upcoming',
  `current_round` int NOT NULL DEFAULT '0',
  `owner_id` varchar(36) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `pod_size` int NOT NULL DEFAULT '2',
  `round_minutes` int NOT NULL DEFAULT '50',
  `points_win` int NOT NULL DEFAULT '3',
  `points_draw` int NOT NULL DEFAULT '1',
  `points_loss` int NOT NULL DEFAULT '0',
  `champion_id` varchar(36) DEFAULT NULL,
  `champion_clan_id` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `owner_id` (`owner_id`),
  KEY `league_id` (`league_id`),
  CONSTRAINT `events_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`),
  CONSTRAINT `events_league_fk` FOREIGN KEY (`league_id`) REFERENCES `leagues` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `event_clans` (
  `id` varchar(36) NOT NULL,
  `event_id` varchar(36) NOT NULL,
  `name` varchar(60) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `event_clan_name` (`event_id`, `name`),
  KEY `event_id` (`event_id`),
  CONSTRAINT `event_clans_event_fk` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `event_players` (
  `id` varchar(36) NOT NULL,
  `event_id` varchar(36) NOT NULL,
  -- só preenchido em Clã Fronto
  `clan_id` varchar(36) DEFAULT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `display_name` varchar(100) NOT NULL,
  `deck_name` varchar(100) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `wins` int NOT NULL DEFAULT '0',
  `losses` int NOT NULL DEFAULT '0',
  `draws` int NOT NULL DEFAULT '0',
  `joined_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `event_id` (`event_id`),
  KEY `user_id` (`user_id`),
  KEY `clan_id` (`clan_id`),
  CONSTRAINT `event_players_ibfk_1` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`),
  CONSTRAINT `event_players_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `event_players_clan_fk` FOREIGN KEY (`clan_id`) REFERENCES `event_clans` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rounds` (
  `id` varchar(36) NOT NULL,
  `event_id` varchar(36) NOT NULL,
  `round_number` int NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL = pareado, mas o organizador ainda não soltou o cronômetro
  `timer_started_at` datetime DEFAULT NULL,
  `is_playoff` tinyint NOT NULL DEFAULT '0',
  `playoff_stage` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `event_id` (`event_id`),
  CONSTRAINT `rounds_ibfk_1` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pairings` (
  `id` varchar(36) NOT NULL,
  `round_id` varchar(36) NOT NULL,
  `event_id` varchar(36) NOT NULL,
  `player1_id` varchar(36) NOT NULL,
  `player2_id` varchar(36) DEFAULT NULL,
  `result` varchar(20) DEFAULT NULL,
  `result_status` varchar(20) NOT NULL DEFAULT 'confirmed',
  -- games ganhos por assento numa mesa 1v1; NULL quando não registrado (só alimenta GW%/OGW%)
  `p1_games` tinyint DEFAULT NULL,
  `p2_games` tinyint DEFAULT NULL,
  `table_number` int DEFAULT NULL,
  `player3_id` varchar(36) DEFAULT NULL,
  `player4_id` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `round_id` (`round_id`),
  KEY `event_id` (`event_id`),
  CONSTRAINT `pairings_ibfk_1` FOREIGN KEY (`round_id`) REFERENCES `rounds` (`id`),
  CONSTRAINT `pairings_ibfk_2` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`),
  -- A seated player can't be deleted out from under their pairing; the API drops
  -- them (status='dropped') instead. See db/migrations/005_pairing_player_fks.sql.
  CONSTRAINT `pairings_player1_fk` FOREIGN KEY (`player1_id`) REFERENCES `event_players` (`id`),
  CONSTRAINT `pairings_player2_fk` FOREIGN KEY (`player2_id`) REFERENCES `event_players` (`id`),
  CONSTRAINT `pairings_player3_fk` FOREIGN KEY (`player3_id`) REFERENCES `event_players` (`id`),
  CONSTRAINT `pairings_player4_fk` FOREIGN KEY (`player4_id`) REFERENCES `event_players` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `message` text NOT NULL,
  `read` tinyint(1) NOT NULL DEFAULT '0',
  -- milissegundos: vários avisos nascem da mesma ação e precisam de ordem estável
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
