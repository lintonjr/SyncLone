-- Fase 2: timer de rodada e placar por games.
--
-- round_minutes: duração alvo da rodada, contada a partir de rounds.created_at.
-- 50 min é o padrão de Magic (MTR 2.5) e vale como default para todos os eventos.
--
-- p1_games / p2_games: games ganhos por assento numa mesa 1v1. Ficam NULL quando
-- o organizador não registra o placar — o vencedor da partida continua vindo de
-- `result`, e o placar por games só alimenta os desempates GW% e OGW%.
-- Pods de 3-4 jogadores não usam essas colunas: "games" não é conceito de pod.

ALTER TABLE events
  ADD COLUMN round_minutes INT NOT NULL DEFAULT 50 AFTER pod_size;

ALTER TABLE pairings
  ADD COLUMN p1_games TINYINT DEFAULT NULL AFTER result_status,
  ADD COLUMN p2_games TINYINT DEFAULT NULL AFTER p1_games;

-- Precisão de milissegundos nas notificações: com datetime de segundo inteiro,
-- os avisos gerados na mesma ação (rodada iniciada, resultado, evento encerrado)
-- empatam no created_at e o painel os lista fora de ordem.
ALTER TABLE notifications
  MODIFY COLUMN created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
