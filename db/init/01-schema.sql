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
  -- Senha temporária criada por um administrador não sobrevive ao primeiro
  -- acesso: alguém além do dono a conhece (migrations/019).
  `must_change_password` tinyint(1) NOT NULL DEFAULT 0,
  -- Papéis excludentes e hierárquicos: admin pode tudo que organizador pode.
  -- Quem cria conta nasce player; organizar depende de pedido aprovado.
  `role` enum('player','organizer','admin') NOT NULL DEFAULT 'player',
  -- Desativar em vez de apagar: o histórico dos torneios aponta para a conta.
  -- `anonimizada` é o "excluir" possível — nome e e-mail somem, o histórico fica.
  `status` enum('ativa','desativada','anonimizada') NOT NULL DEFAULT 'ativa',
  `profile_public` tinyint(1) NOT NULL DEFAULT '1',
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

-- Co-organizadores: o time que cuida da liga e de todos os eventos dela
-- (migrations/016). O papel de organizador é conferido em users.role a cada ação.
CREATE TABLE IF NOT EXISTS `league_organizers` (
  `league_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `added_by` varchar(36) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`league_id`, `user_id`),
  KEY `por_usuario` (`user_id`),
  CONSTRAINT `league_organizers_league_fk` FOREIGN KEY (`league_id`) REFERENCES `leagues` (`id`) ON DELETE CASCADE,
  CONSTRAINT `league_organizers_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `league_organizers_added_by_fk` FOREIGN KEY (`added_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `events` (
  `id` varchar(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `city` varchar(100) DEFAULT NULL,
  `address` text,
  `online` tinyint(1) NOT NULL DEFAULT '0',
  `thumbnail` varchar(255) DEFAULT NULL,
  -- Instante do torneio, em UTC (migrations/017). A hora é exibida sempre em
  -- `timezone`, o fuso onde o torneio acontece, e não no fuso de quem olha.
  `date` datetime NOT NULL,
  `timezone` varchar(64) NOT NULL DEFAULT 'America/Manaus',
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
  `joined_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `event_player_conta` (`event_id`, `user_id`),
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
  -- Nulo nas linhas novas: elas guardam `code` e a tela é que traduz. A coluna
  -- fica para as antigas, escritas quando a frase era montada no servidor.
  `message` text NULL,
  `code` varchar(60) DEFAULT NULL,
  `params` json DEFAULT NULL,
  `read` tinyint(1) NOT NULL DEFAULT '0',
  -- milissegundos: vários avisos nascem da mesma ação e precisam de ordem estável
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `user_recentes` (`user_id`, `created_at`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Badges: reconhecimentos que um organizador cria e entrega a jogadores.
--
-- A badge pertence a quem a criou, como as ligas. Duas lojas podem ter cada uma
-- o seu "Campeão do Mês" sem colidir — o UNIQUE é por dono, e impede só o caso
-- que confunde de verdade: dois nomes iguais do mesmo organizador.

CREATE TABLE IF NOT EXISTS `badges` (
  `id` varchar(36) NOT NULL,
  `owner_id` varchar(36) NOT NULL,
  `name` varchar(60) NOT NULL,
  `image` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `badge_dono_nome` (`owner_id`, `name`),
  CONSTRAINT `badges_owner_fk` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A entrega. A mesma badge vai para quantos jogadores o organizador quiser, mas
-- nunca duas vezes para a mesma pessoa — daí a chave única do par.
--
-- `awarded_by` existe separado do dono da badge porque hoje são a mesma pessoa e
-- amanhã podem não ser: é o que responde "quem me deu isto".
--
-- `visible` é do jogador, não de quem entregou. Nasce ligada porque receber é
-- conquista; esconder é a exceção.
CREATE TABLE IF NOT EXISTS `user_badges` (
  `id` varchar(36) NOT NULL,
  `badge_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `awarded_by` varchar(36) NOT NULL,
  `visible` tinyint(1) NOT NULL DEFAULT '1',
  `awarded_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `badge_por_jogador` (`badge_id`, `user_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `user_badges_badge_fk` FOREIGN KEY (`badge_id`) REFERENCES `badges` (`id`),
  CONSTRAINT `user_badges_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `user_badges_awarder_fk` FOREIGN KEY (`awarded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Histórico da conta: papel, nome, e-mail, senha, estado e visibilidade — quem
-- mudou o quê, quando e por quê (migrations/018 e 019).
CREATE TABLE IF NOT EXISTS `user_history` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `acao` enum('papel','nome','email','senha','status','visibilidade') NOT NULL DEFAULT 'papel',
  `de` varchar(255) DEFAULT NULL,
  `para` varchar(255) DEFAULT NULL,
  `autor_id` varchar(36) DEFAULT NULL,
  `motivo` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `por_usuario` (`user_id`, `created_at`),
  -- As FKs mantêm o nome antigo de propósito: `RENAME TABLE` não renomeia
  -- constraint, então é assim que o banco de quem veio da 018 se chama. Trocar
  -- aqui faria o schema consolidado divergir do caminho de upgrade.
  CONSTRAINT `role_changes_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `role_changes_autor_fk` FOREIGN KEY (`autor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pedidos para virar organizador.
--
-- Organizar não é self-service: o jogador pede, o dono da plataforma decide. A
-- tabela guarda o pedido e a decisão na mesma linha porque é uma coisa só — um
-- pedido sem desfecho é o que está na fila, e um com desfecho é o histórico.
--
-- `pendente` vale 1 enquanto o pedido está na fila e NULL depois de decidido.
-- Como índice único ignora NULL, o banco garante um pendente por pessoa sem
-- impedir que ela peça de novo depois de uma recusa.
CREATE TABLE IF NOT EXISTS `organizer_requests` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `justification` text DEFAULT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `decided_by` varchar(36) DEFAULT NULL,
  `decided_at` datetime(3) DEFAULT NULL,
  `reason` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `pendente` tinyint GENERATED ALWAYS AS (IF(`status` = 'pending', 1, NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `um_pendente_por_usuario` (`user_id`, `pendente`),
  KEY `fila` (`status`, `created_at`),
  CONSTRAINT `organizer_requests_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `organizer_requests_admin_fk` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
