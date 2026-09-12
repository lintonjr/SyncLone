-- Notificações deixam de guardar a frase pronta e passam a guardar o código.
--
-- É o mesmo problema das mensagens de erro da API, um passo atrás: a coluna
-- `message` guardava português. Quem troca o idioma para inglês continuava
-- vendo as notificações em português, e as antigas nunca poderiam ser
-- retraduzidas — a tradução acontecia no momento da escrita, e ali ela é
-- irreversível.
--
-- `message` continua existindo e nulável: é o que as linhas antigas já têm, e é
-- por onde a tela as mostra enquanto elas durarem. As novas nascem só com
-- código, e a tela renderiza.
--
-- O índice acompanha porque a leitura é sempre "as mais recentes desta pessoa",
-- e hoje a ordenação era feita em memória a cada abertura do sino.

ALTER TABLE notifications
  MODIFY COLUMN `message` text NULL,
  ADD COLUMN `code` varchar(60) DEFAULT NULL AFTER `message`,
  ADD COLUMN `params` json DEFAULT NULL AFTER `code`,
  ADD KEY `user_recentes` (`user_id`, `created_at`);
