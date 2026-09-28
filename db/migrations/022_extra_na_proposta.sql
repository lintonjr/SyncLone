-- Um acréscimo em reais na proposta, além do percentual.
--
-- O caso do balcão: a planilha soma R$ 1.400, mas havia três cartas raras fora
-- da lista, ou a coleção veio organizada em fichário e isso poupa uma tarde. O
-- percentual não resolve isso — mexer nele mudaria a conta de tudo para acertar
-- uma parte.
--
-- Três decisões:
--
-- 1. **`valor_credito` e `valor_pix` continuam sendo o valor a PAGAR**, agora com
--    o extra já somado. Nove lugares leem esses dois campos e um deles é a
--    instrução de quanto dinheiro entregar; deixá-los como "só o percentual" e
--    somar o extra em cada leitor seria contar com ninguém esquecer. A parte do
--    percentual, quando a tela mostra a quebra, é `valor - valor_extra`:
--    subtração exata, sem arredondamento, sempre fechando com o total.
-- 2. **`NOT NULL DEFAULT 0`**, não anulável. Zero e "não teve extra" são a mesma
--    coisa aqui, e um `NULL` no meio de uma soma é como um total vira nulo.
-- 3. **A justificativa é interna**, como `link_avaliacao`: `dadosPublicos` não a
--    devolve. O cliente vê o total; a explicação é anotação da loja, e a rota
--    exige que ela exista sempre que o extra for maior que zero.
--
-- Congelado na linha como o resto da proposta: o extra de hoje não muda porque a
-- política mudou no ano que vem.

ALTER TABLE avaliacoes
  ADD COLUMN `valor_extra` decimal(10,2) NOT NULL DEFAULT 0.00 AFTER `valor_pix`,
  ADD COLUMN `justificativa_extra` text DEFAULT NULL AFTER `valor_extra`;

-- Sem isto, o registro de uma OS excluída guardaria o bruto e os percentuais mas
-- não explicaria o total que foi oferecido.
ALTER TABLE avaliacao_exclusoes
  ADD COLUMN `valor_extra` decimal(10,2) DEFAULT NULL AFTER `percentual_pix`;
