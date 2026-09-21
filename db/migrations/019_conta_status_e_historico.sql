-- A conta ganha estado, e o histórico deixa de ser só de papel.
--
-- A área de usuários passa a editar nome e e-mail, redefinir senha, desativar e
-- anonimizar. Três consequências no schema:
--
-- 1. `status` — desativar em vez de apagar. Apagar de verdade não é opção: 13
--    chaves estrangeiras apontam para `users` (eventos criados, inscrições,
--    resultados, badges, ligas), e remover a linha levaria o histórico dos
--    torneios junto. `anonimizada` é o "excluir" possível: nome e e-mail somem,
--    o histórico fica de pé.
-- 2. `must_change_password` — senha temporária que um administrador gerou não
--    pode sobreviver ao primeiro acesso: alguém além do dono a conhece.
-- 3. `role_changes` vira `user_history`, com o tipo da ação. A tabela nasceu na
--    migration 018 e está praticamente vazia; unificar agora evita duas linhas
--    do tempo na mesma ficha. `de`/`para` viram texto porque agora guardam
--    também nome, e-mail e estado — não só papel.

ALTER TABLE users
  ADD COLUMN `status` enum('ativa','desativada','anonimizada') NOT NULL DEFAULT 'ativa' AFTER `role`,
  ADD COLUMN `must_change_password` tinyint(1) NOT NULL DEFAULT 0 AFTER `password_hash`;

RENAME TABLE role_changes TO user_history;

ALTER TABLE user_history
  ADD COLUMN `acao` enum('papel','nome','email','senha','status','visibilidade') NOT NULL DEFAULT 'papel' AFTER `user_id`,
  MODIFY COLUMN `de` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `para` varchar(255) DEFAULT NULL;
