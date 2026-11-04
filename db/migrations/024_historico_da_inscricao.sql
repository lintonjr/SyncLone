-- Histórico da inscrição: quem entrou, quem saiu, quem tirou e quem trouxe de volta.
--
-- O caso que criou esta tabela: um jogador terminou as quatro rodadas de uma
-- etapa de liga, com todos os resultados confirmados, e sumiu da classificação.
-- Dava para provar *quando* (o pareamento só sorteia quem está ativo, então ele
-- estava ativo na última rodada) e dava para provar que *alguém* fez isso — o
-- sistema não dropa ninguém sozinho, são três rotas e todas humanas. Mas não
-- havia como dizer **quem**: `event_players` guarda só o estado atual, sem autor
-- e sem data de alteração, e o `user_history` é da conta, não da inscrição.
--
-- Quatro decisões:
--
-- 1. **Sem FK para `event_players`.** A inscrição que nunca sentou à mesa é
--    APAGADA (routes/events.js, retirePlayer) em vez de marcada, e é justamente
--    esse caso que o histórico precisa sobreviver para responder — "quem apagou a
--    inscrição do João?" não tem mais linha a que se referir. Por isso o nome vai
--    gravado junto: a linha tem de ser legível depois que o alvo não existe mais.
-- 2. **`acao` em vez de só `de`/`para`.** Sair por conta própria e ser tirado pelo
--    organizador terminam no mesmo `status`, e são fatos diferentes — a diferença
--    é a resposta à pergunta que trouxe a tabela ao mundo. `de`/`para` ficam do
--    lado para a transição crua, no mesmo formato do `user_history`.
-- 3. **`autor_id` aceita NULL.** Convidado sem conta não tem a quem atribuir, e
--    inscrição feita pelo organizador para um nome avulso também não.
-- 3b. **`alterado` fecha o conjunto.** A derivação da ação é total: toda troca de
--    status cai num rótulo, e as que a tela não faz (devolver alguém para a fila
--    de pendentes, por exemplo) caem em `alterado` em vez de ficarem sem linha.
--    Auditoria com buraco é pior que auditoria grosseira.
-- 4. **Nada de `ON DELETE CASCADE` no evento.** A FK de `event_id` é a que impede
--    histórico órfão de evento inexistente; apagar um evento é operação que já
--    passa pelas outras FKs e continua passando.

CREATE TABLE IF NOT EXISTS `event_player_history` (
  `id` varchar(36) NOT NULL,
  `event_id` varchar(36) NOT NULL,
  `event_player_id` varchar(36) NOT NULL,
  -- Retrato do nome no momento do fato: a linha pode ter sido apagada, e um
  -- convidado vinculado a uma conta depois passa a se chamar outra coisa.
  `display_name` varchar(100) NOT NULL,
  `acao` enum('entrou','saiu','removido','restaurado','aprovado','rejeitado','excluido','alterado') NOT NULL,
  `de` varchar(20) DEFAULT NULL,
  `para` varchar(20) DEFAULT NULL,
  `autor_id` varchar(36) DEFAULT NULL,
  `motivo` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- "O que aconteceu no elenco deste torneio", que é como a tela do organizador lê.
  KEY `por_evento` (`event_id`, `created_at`),
  -- "A vida desta inscrição", para a linha do tempo de um jogador só.
  KEY `por_inscricao` (`event_player_id`, `created_at`),
  CONSTRAINT `eph_event_fk` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`),
  CONSTRAINT `eph_autor_fk` FOREIGN KEY (`autor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
