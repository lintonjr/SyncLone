-- Uma conta entra uma vez por evento, e o banco passa a garantir isso.
--
-- A checagem existe na rota que inscreve, mas era só ela: um SELECT seguido de
-- um INSERT, sem transação. O que segurava a inscrição dupla era a serialização
-- do pool, não uma restrição.
--
-- A vinculação de convidados (o organizador aponta que a linha "Ana" é a conta
-- da Ana) cria um segundo caminho para chegar ao mesmo estado, e é ele que
-- transforma a garantia em obrigatória.
--
-- Convidados não conflitam: `user_id` é NULL neles, e o MySQL admite quantos
-- NULLs quiser numa chave única.

ALTER TABLE event_players
  ADD UNIQUE KEY `event_player_conta` (`event_id`, `user_id`);
