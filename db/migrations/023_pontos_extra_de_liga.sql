-- Ponto extra por torneio participado, na pontuação da liga.
--
-- O caso: a liga quer premiar presença, não só resultado. Quem apareceu em oito
-- dos dez torneios leva uma vantagem sobre quem veio a dois e ganhou os dois.
--
-- Três decisões:
--
-- 1. **Uma coluna, não duas.** O interruptor da tela é derivado de `> 0`. Um
--    booleano separado mais um número podem discordar — marcado com zero,
--    desmarcado com cinco — e aí não existe resposta certa sobre qual vale. Zero
--    é "desligado", e é o DEFAULT, então nenhuma liga existente muda de conta.
-- 2. **`INT UNSIGNED`**, com a faixa 1–99 conferida na rota. A coluna aceita mais
--    do que isso porque quem valida faixa é a aplicação, mas o sinal negativo o
--    banco recusa por tipo: este é um bônus, não um ajuste.
-- 3. **Nada de pontuação gravada.** A liga continua somando as mesas confirmadas
--    a cada carregamento, e o bônus é calculado ali junto. É o que mantém a
--    escala de pontos coerente quando o organizador mexe em `points_win` no meio
--    do torneio — e o preço é que ligar o bônus vale para trás, recalculando as
--    ligas passadas na hora.
--
-- O bônus **não** entra na classificação de nenhum torneio: `computeStandings`
-- não sabe que ele existe. Ele mora só na agregação da liga.

ALTER TABLE leagues
  ADD COLUMN `pontos_extra` int unsigned NOT NULL DEFAULT 0 AFTER `playoff_counts`;
