-- Clã Fronto: torneio disputado por times de quatro.
--
-- O formato entra como campo próprio do evento, e não como mais um método de
-- pareamento: ele muda inscrição, pontuação e playoff, não só a forma de montar
-- a mesa. Os quatro métodos existentes continuam valendo dentro dele.

ALTER TABLE events
  ADD COLUMN tournament_format varchar(30) NOT NULL DEFAULT 'standard' AFTER format,
  ADD COLUMN champion_clan_id varchar(36) DEFAULT NULL AFTER champion_id;

CREATE TABLE IF NOT EXISTS `event_clans` (
  `id` varchar(36) NOT NULL,
  `event_id` varchar(36) NOT NULL,
  `name` varchar(60) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- dois clãs de mesmo nome no mesmo evento tornariam a tabela ilegível
  UNIQUE KEY `event_clan_name` (`event_id`, `name`),
  KEY `event_id` (`event_id`),
  CONSTRAINT `event_clans_event_fk` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NULL em qualquer formato que não seja Clã Fronto.
ALTER TABLE event_players
  ADD COLUMN clan_id varchar(36) DEFAULT NULL AFTER event_id,
  ADD KEY clan_id (clan_id),
  ADD CONSTRAINT event_players_clan_fk FOREIGN KEY (clan_id) REFERENCES event_clans (id);
