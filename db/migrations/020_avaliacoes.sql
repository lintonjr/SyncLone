-- Avaliação de coleção: a ordem de serviço do balcão.
--
-- É o primeiro fluxo do sistema que não gira em torno de torneio, e o primeiro
-- em que a outra ponta é uma pessoa **sem conta**: ela recebe um link, vê a
-- proposta e responde. Daí as três decisões deste schema:
--
-- 1. O contato (nome, telefone, e-mail) é dado da OS, não de `users`. Quem vende
--    a coleção pode nunca ter jogado um torneio aqui, e transformar cada cliente
--    numa conta encheria a plataforma de gente que não pediu para entrar.
-- 2. Os valores ficam **congelados** na linha: o bruto que o avaliador lançou, os
--    percentuais vigentes e os dois valores já calculados. Se a loja passar de
--    60% para 55% no ano que vem, a OS de hoje continua mostrando o que foi
--    oferecido hoje — é uma proposta comercial, não um cálculo ao vivo.
-- 3. `token_publico` é o que segura a página sem login. Trinta e dois caracteres
--    de `crypto.randomBytes`: quem não recebeu o link não descobre a OS, porque
--    não existe rota que liste por token.
--
-- `avaliador` em `users` é permissão, não papel: o funcionário que avalia coleção
-- costuma ser o mesmo que organiza o torneio de sexta, e os papéis são
-- excludentes na coluna. Por isso uma marca ao lado, e não um quarto valor.

ALTER TABLE users
  ADD COLUMN `avaliador` tinyint(1) NOT NULL DEFAULT 0 AFTER `role`;

-- Ligar e desligar a permissão entra na mesma linha do tempo da ficha.
ALTER TABLE user_history
  MODIFY COLUMN `acao` enum('papel','nome','email','senha','status','visibilidade','avaliador')
    NOT NULL DEFAULT 'papel';

CREATE TABLE IF NOT EXISTS `avaliacoes` (
  `id` varchar(36) NOT NULL,
  -- Ditado no balcão e digitado na busca: alfabeto sem 0/O/1/l/I.
  `codigo` varchar(12) NOT NULL,
  `nome` varchar(120) NOT NULL,
  `telefone` varchar(30) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `comentarios` text DEFAULT NULL,
  `status` enum('para_avaliar','avaliado','recusada','a_pagar','para_guardar','para_inserir','inserido')
    NOT NULL DEFAULT 'para_avaliar',
  -- A lista item a item que justifica o valor. Interno: a página do cliente
  -- mostra os valores e os comentários, nunca a planilha.
  `link_avaliacao` varchar(500) DEFAULT NULL,
  `valor_bruto` decimal(10,2) DEFAULT NULL,
  `percentual_credito` tinyint unsigned NOT NULL DEFAULT 60,
  `percentual_pix` tinyint unsigned NOT NULL DEFAULT 50,
  `valor_credito` decimal(10,2) DEFAULT NULL,
  `valor_pix` decimal(10,2) DEFAULT NULL,
  `token_publico` char(32) DEFAULT NULL,
  `escolha` enum('credito','pix') DEFAULT NULL,
  `chave_pix` varchar(140) DEFAULT NULL,
  `comprovante` varchar(255) DEFAULT NULL,
  `criada_por` varchar(36) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `codigo` (`codigo`),
  UNIQUE KEY `token_publico` (`token_publico`),
  KEY `por_status` (`status`, `created_at`),
  CONSTRAINT `avaliacoes_criador_fk` FOREIGN KEY (`criada_por`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quem fez o quê, quando. `autor_id` nulo é o cliente: ele responde por um link
-- sem login, então não há a quem atribuir — e é assim que tem de ser, não é uma
-- limitação a contornar depois com o IP dele.
CREATE TABLE IF NOT EXISTS `avaliacao_historico` (
  `id` varchar(36) NOT NULL,
  `avaliacao_id` varchar(36) NOT NULL,
  `acao` enum('criada','editada','avaliada','aceita','recusada','pagamento','avanco','retorno') NOT NULL,
  `de` varchar(255) DEFAULT NULL,
  `para` varchar(255) DEFAULT NULL,
  `autor_id` varchar(36) DEFAULT NULL,
  `motivo` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `por_avaliacao` (`avaliacao_id`, `created_at`),
  CONSTRAINT `avaliacao_historico_os_fk` FOREIGN KEY (`avaliacao_id`) REFERENCES `avaliacoes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `avaliacao_historico_autor_fk` FOREIGN KEY (`autor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
