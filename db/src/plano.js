const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Decidir o que fazer com um banco, sem tocar nele.
 *
 * Tudo aqui é puro: recebe o que existe no disco e o que o banco diz que já tem,
 * e devolve um plano. É a parte onde um erro custa caro — aplicar um `ALTER` duas
 * vezes, ou pular um — então é a parte que precisa ser testável sem MySQL.
 */

/** `001_descricao.sql`: três dígitos, sublinhado, nome. Nada mais é migration. */
const PADRAO_MIGRATION = /^(\d{3})_[a-z0-9_]+\.sql$/;

/**
 * O resumo de um arquivo de migration.
 *
 * Quebras de linha são normalizadas antes: o mesmo arquivo salvo num editor do
 * Windows não pode parecer uma migration alterada.
 */
function checksum(conteudo) {
  return crypto.createHash('sha256').update(conteudo.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/** As migrations do diretório, em ordem, com conteúdo e resumo. */
function listarMigrations(diretorio, { ler = fs.readFileSync, listar = fs.readdirSync } = {}) {
  const nomes = listar(diretorio).filter((n) => n.endsWith('.sql')).sort();

  const invalidos = nomes.filter((n) => !PADRAO_MIGRATION.test(n));
  if (invalidos.length) {
    throw new Error(`arquivos fora do padrão NNN_nome.sql em ${diretorio}: ${invalidos.join(', ')}`);
  }

  const numeros = new Set();
  return nomes.map((nome) => {
    const numero = PADRAO_MIGRATION.exec(nome)[1];
    if (numeros.has(numero)) throw new Error(`duas migrations com o número ${numero}`);
    numeros.add(numero);
    const sql = ler(path.join(diretorio, nome), 'utf8');
    return { versao: nome, sql, checksum: checksum(sql) };
  });
}

/**
 * O plano para um banco.
 *
 * @param {object} estado
 * @param {boolean} estado.temTabelas  se o schema da aplicação já existe (tabela `users`)
 * @param {Map<string,string>} estado.registradas  versão → checksum, de `schema_migrations`
 * @param {Array} estado.arquivos  saída de `listarMigrations`
 * @param {'aplicar'|'baseline'} comando
 *
 * Os casos:
 *
 * - **Banco vazio**: o schema consolidado (`init/01-schema.sql`) já contém todas
 *   as migrations existentes. Aplicá-lo e registrar todas como `baseline` é o
 *   único caminho certo — rodar as migrations por cima falharia no primeiro
 *   `ADD COLUMN` que já existe.
 * - **Banco com tabelas e sem histórico**: não há como saber quais migrations ele
 *   tem. Adivinhar é como se corrompe um banco; o plano **recusa** e pede o
 *   `baseline`, que é uma afirmação explícita de quem conhece aquele banco.
 * - **Banco com histórico**: aplica as que faltam, em ordem. Uma migration já
 *   aplicada cujo arquivo mudou é erro — ela já rodou com o conteúdo antigo, e o
 *   banco de produção nunca vai ver o novo.
 */
function planejar({ temTabelas, registradas, arquivos }, comando = 'aplicar') {
  const conhecidas = new Set(arquivos.map((a) => a.versao));
  const orfas = [...registradas.keys()].filter((v) => !conhecidas.has(v));

  const divergentes = arquivos
    .filter((a) => registradas.has(a.versao) && registradas.get(a.versao) !== a.checksum)
    .map((a) => a.versao);
  if (divergentes.length) {
    return {
      acao: 'erro',
      motivo:
        `migrations já aplicadas foram alteradas depois: ${divergentes.join(', ')}. ` +
        'Crie uma migration nova com a correção em vez de editar a antiga.',
    };
  }

  const pendentes = arquivos.filter((a) => !registradas.has(a.versao));

  if (comando === 'baseline') {
    if (!temTabelas) {
      return { acao: 'erro', motivo: 'baseline num banco sem tabelas não faz sentido: use aplicar' };
    }
    return { acao: 'baseline', registrar: pendentes, orfas };
  }

  if (comando !== 'aplicar') return { acao: 'erro', motivo: `comando desconhecido: ${comando}` };

  if (!temTabelas && registradas.size === 0) {
    return { acao: 'schema-inicial', registrar: arquivos, orfas };
  }

  if (temTabelas && registradas.size === 0) {
    return {
      acao: 'erro',
      motivo:
        'o banco já tem tabelas mas nenhum histórico de migrations. Confira que ele está ' +
        'com todas as migrations de db/migrations aplicadas e rode `baseline` uma vez.',
    };
  }

  if (!temTabelas) {
    return {
      acao: 'erro',
      motivo: 'há histórico de migrations mas a tabela users não existe: o banco foi alterado à mão',
    };
  }

  return { acao: 'migrar', aplicar: pendentes, orfas };
}

module.exports = { checksum, listarMigrations, planejar, PADRAO_MIGRATION };
