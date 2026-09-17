-- Co-organizadores de liga: um time que cuida da liga inteira.
--
-- Até aqui a liga tinha um dono e só ele mexia nela e nos eventos que ela reúne.
-- Liga de loja é trabalho de equipe: quem conduz a noite de sexta não é quem
-- conduz a de sábado, e todos precisam lançar resultado, desfazer rodada e aprovar
-- inscrição em qualquer torneio da liga — inclusive nos que não criaram.
--
-- Uma tabela de ligação, e não uma coluna de lista: o dono adiciona e remove
-- pessoas, e cada linha guarda quem adicionou e quando.
--
-- O papel de organizador NÃO é copiado para cá. Ele é conferido em `users.role`
-- a cada ação: quem perde o acesso de organizador perde junto o acesso às ligas,
-- sem precisar lembrar de limpar esta tabela.
--
-- Apagar a liga apaga o time (CASCADE). Apagar um usuário não é caminho que o
-- sistema tenha, então as outras chaves ficam como as demais do schema.

CREATE TABLE IF NOT EXISTS `league_organizers` (
  `league_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `added_by` varchar(36) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`league_id`, `user_id`),
  -- "Em quais ligas esta pessoa organiza": a pergunta de toda checagem de acesso.
  KEY `por_usuario` (`user_id`),
  CONSTRAINT `league_organizers_league_fk` FOREIGN KEY (`league_id`) REFERENCES `leagues` (`id`) ON DELETE CASCADE,
  CONSTRAINT `league_organizers_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `league_organizers_added_by_fk` FOREIGN KEY (`added_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
