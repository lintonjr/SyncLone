-- Os pontos deixam de ser uma coluna e passam a ser um cálculo.
--
-- `event_players.points` era somado resultado a resultado, sempre com o
-- `points_win` vigente naquele instante. `computeStandings` já refazia a mesma
-- conta do zero, com o `points_win` atual, para produzir o MW%. Duas fontes de
-- verdade sobre o mesmo número: concordavam enquanto ninguém mexia na pontuação
-- do evento, e discordavam em silêncio assim que alguém mexia — dois jogadores
-- com o mesmo cartel terminavam com totais diferentes, e era a coluna que
-- ordenava a tabela.
--
-- Nada se perde: todo ponto é reconstruível de `pairings`. A migração 002 criou
-- `result_status` com default 'confirmed', então nenhum resultado anterior a ela
-- fica de fora do cálculo.

ALTER TABLE event_players DROP COLUMN points;
