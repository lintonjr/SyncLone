-- O jogador decide se o seu perfil é público.
--
-- O perfil não revela nada que já não esteja visível: nome, cartel e colocação
-- aparecem na classificação de cada evento. O que ele faz é reunir tudo num
-- lugar só — e reunir é diferente de espalhar. Quem não quer a própria história
-- agregada numa página precisa poder dizer isso.
--
-- O padrão é público porque preserva o comportamento de hoje e porque o dado já
-- é público mesmo. Uma linha muda isso, se a decisão for outra.

ALTER TABLE users
  ADD COLUMN profile_public tinyint(1) NOT NULL DEFAULT 1 AFTER role;
