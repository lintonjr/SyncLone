-- Histórico de troca de papel: quem mudou o quê, quando e por quê.
--
-- Até aqui promover ou rebaixar deixava só o aviso na caixa da pessoa — nada que
-- respondesse "quem promoveu o Bruno?" seis meses depois. Numa plataforma com
-- mais de um administrador, essa é a primeira pergunta quando alguém estranha um
-- acesso.
--
-- `autor_id` não é nulo: toda troca sai da mesa de um administrador. A promoção
-- inicial do dono (bootstrapAdmin) e a aprovação de pedido também passam a
-- registrar — a segunda com o próprio decisor como autor.

CREATE TABLE IF NOT EXISTS `role_changes` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `de` enum('player','organizer','admin') NOT NULL,
  `para` enum('player','organizer','admin') NOT NULL,
  -- NULL quando a troca veio do próprio sistema (primeiro admin na subida).
  `autor_id` varchar(36) DEFAULT NULL,
  `motivo` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- "O histórico desta pessoa", que é como a ficha da área de usuários lê.
  KEY `por_usuario` (`user_id`, `created_at`),
  CONSTRAINT `role_changes_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `role_changes_autor_fk` FOREIGN KEY (`autor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
