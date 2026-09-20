-- A data do evento passa a ser um instante em UTC, com o fuso do evento ao lado.
--
-- Até aqui a coluna guardava o horário de parede digitado no formulário ("20:00"),
-- mas o backend lia a conexão como UTC e a API devolvia "20:00Z". O navegador então
-- convertia para o fuso de quem olhava: em UTC-4, as 20:00 da loja viravam 16:00.
--
-- Agora `date` é o instante (UTC) e `timezone` diz em que fuso o torneio acontece —
-- é nele que a hora é exibida, para todo mundo, esteja onde estiver. Guardar o fuso,
-- e não só o deslocamento, é o que faz o horário de verão de uma cidade ser tratado
-- corretamente no futuro: -03 e -02 são o mesmo `America/Sao_Paulo`.
--
-- As linhas existentes foram gravadas como horário de parede do fuso padrão
-- (America/Manaus, UTC-4 o ano inteiro, sem horário de verão desde nunca): somar 4
-- horas as converte para UTC. Um intervalo fixo, e não CONVERT_TZ, porque a conversão
-- por nome depende das tabelas de fuso carregadas no servidor — o que o RDS tem, mas
-- um MySQL local pode não ter, e uma migration não pode depender disso.

ALTER TABLE events
  ADD COLUMN `timezone` varchar(64) NOT NULL DEFAULT 'America/Manaus' AFTER `date`;

UPDATE events SET `date` = DATE_ADD(`date`, INTERVAL 4 HOUR);
