-- O cronômetro deixa de começar junto com a rodada.
--
-- Antes, a contagem saía de rounds.created_at: no instante em que o organizador
-- gerava os pareamentos, o relógio já estava correndo — e o tempo que os jogadores
-- levam para achar a mesa e sentar saía do tempo de jogo deles.
--
-- Agora são dois momentos: criar a rodada (pareamentos no ar) e soltar o tempo.
-- NULL significa "pareado, mas o relógio ainda não começou".

ALTER TABLE rounds
  ADD COLUMN timer_started_at datetime DEFAULT NULL AFTER created_at;

-- Rodadas que já existem mantêm o comportamento antigo, senão o histórico
-- passaria a exibir todas como se nunca tivessem começado.
UPDATE rounds SET timer_started_at = created_at WHERE timer_started_at IS NULL;
