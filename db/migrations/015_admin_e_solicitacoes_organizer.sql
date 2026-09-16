-- Organizar deixa de ser self-service: passa a ser pedido e decisão.
--
-- Até aqui qualquer jogador clicava um botão e virava organizador na hora. Isso
-- funcionava enquanto o sistema era de uma pessoa só; a partir do momento em que
-- existe um dono da plataforma, quem organiza torneios é escolha dele.
--
-- O papel `admin` é acrescentado ao enum em vez de virar uma tabela de permissões:
-- os três papéis são excludentes e hierárquicos (admin pode tudo que organizador
-- pode), e uma tabela de permissões para três valores fixos seria estrutura sem
-- pergunta que a justifique.
--
-- Quem já é organizador continua sendo. Rebaixar 58 contas que entraram pela
-- porta que o próprio sistema abriu deixaria eventos existentes com um dono sem
-- permissão para tocá-los — a aprovação vale de agora em diante.

ALTER TABLE users
  MODIFY COLUMN `role` enum('player','organizer','admin') NOT NULL DEFAULT 'player';

CREATE TABLE IF NOT EXISTS `organizer_requests` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  -- Por que a pessoa quer organizar. Opcional: é contexto para a decisão, não
  -- um formulário a ser preenchido corretamente.
  `justification` text DEFAULT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  -- Quem decidiu, quando e por quê. `reason` vale para os dois lados: uma
  -- aprovação também pode vir com recado.
  `decided_by` varchar(36) DEFAULT NULL,
  `decided_at` datetime(3) DEFAULT NULL,
  `reason` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- Um pedido pendente por pessoa, cobrado pelo banco e não por uma consulta
  -- prévia na rota: a coluna vale 1 enquanto o pedido está na fila e NULL depois
  -- de decidido, e índice único ignora NULL. Assim o histórico cresce sem limite
  -- (pedir de novo depois de uma recusa é permitido) e duas abas clicando junto
  -- não criam duas linhas na fila.
  `pendente` tinyint GENERATED ALWAYS AS (IF(`status` = 'pending', 1, NULL)) STORED,

  PRIMARY KEY (`id`),
  UNIQUE KEY `um_pendente_por_usuario` (`user_id`, `pendente`),
  KEY `fila` (`status`, `created_at`),
  CONSTRAINT `organizer_requests_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `organizer_requests_admin_fk` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
