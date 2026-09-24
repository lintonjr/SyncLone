-- Excluir uma avaliação: o que sobra quando a OS não sobra.
--
-- Até aqui, nada no módulo de avaliação desaparecia: recusar é um status, voltar
-- um passo é um registro com motivo, e o histórico guarda quem fez o quê. Excluir
-- rompe isso de propósito, para o caso que o fluxo não cobria — a OS aberta por
-- engano no balcão, o teste que ficou na lista, o código ditado errado.
--
-- Três decisões deste schema:
--
-- 1. **Sem chave estrangeira para `avaliacoes`.** A linha desta tabela nasce
--    justamente quando a de lá morre; uma FK impediria o único uso que ela tem.
--    O `codigo` é o elo, e ele era único enquanto a OS existia.
-- 2. **Não copia tudo.** O e-mail, o link da planilha e a chave pix somem com a
--    OS. Guardar dado pessoal de um negócio que a loja decidiu apagar seria o
--    contrário do que apagar significa. Fica o que responde "o que houve com a
--    OS K7M4-Q2X9?": código, contato mínimo, em que pé estava e quanto valia.
-- 3. **`autor_id` é obrigatório**, ao contrário do histórico da OS. Lá, nulo é o
--    cliente respondendo por um link sem login; aqui não existe exclusão sem
--    alguém logado — a rota é só para admin.
--
-- O `avaliacao_historico` da OS apagada some junto, pelo ON DELETE CASCADE que
-- já existe na 020. É por isso que esta tabela precisa existir: sem ela, apagar
-- não deixaria vestígio nenhum.

CREATE TABLE IF NOT EXISTS `avaliacao_exclusoes` (
  `id` varchar(36) NOT NULL,
  `codigo` varchar(12) NOT NULL,
  `nome` varchar(120) NOT NULL,
  `telefone` varchar(30) NOT NULL,
  `status_na_exclusao` enum('para_avaliar','avaliado','recusada','a_pagar','para_guardar','para_inserir','inserido') NOT NULL,
  `valor_bruto` decimal(10,2) DEFAULT NULL,
  `percentual_credito` tinyint unsigned DEFAULT NULL,
  `percentual_pix` tinyint unsigned DEFAULT NULL,
  `escolha` enum('credito','pix') DEFAULT NULL,
  `autor_id` varchar(36) NOT NULL,
  `motivo` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- Consulta natural: "o que foi apagado, do mais recente para o mais antigo".
  KEY `por_data` (`created_at`),
  -- E a outra: "o que houve com a OS K7M4-Q2X9?". Não é único — um código
  -- sorteado pode, em tese, sair de novo anos depois para outra coleção.
  KEY `por_codigo` (`codigo`),
  CONSTRAINT `avaliacao_exclusoes_autor_fk` FOREIGN KEY (`autor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
