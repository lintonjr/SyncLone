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
