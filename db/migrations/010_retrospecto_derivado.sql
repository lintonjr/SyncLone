-- Vitórias, derrotas e empates deixam de ser colunas e passam a ser cálculo.
--
-- Mesma história dos pontos (migração 009), um passo depois. `wins`, `losses` e
-- `draws` eram somados a cada resultado lançado, e o mesmo laço precisava ser
-- desfeito quando o organizador corrigia uma mesa ou desfazia uma rodada. Cada
-- um desses caminhos tinha de lembrar sozinho das regras do jogo — inclusive da
-- mesa de duplas do Clã Fronto, onde dois assentos vencem juntos.
--
-- `computeStandings` já percorria as mesas confirmadas para produzir os pontos e
-- os desempates; contar o retrospecto na mesma passada custa três contadores e
-- elimina três caminhos de escrita que podiam divergir.
--
-- Nada se perde: tudo é reconstruível de `pairings`.

ALTER TABLE event_players
  DROP COLUMN wins,
  DROP COLUMN losses,
  DROP COLUMN draws;
