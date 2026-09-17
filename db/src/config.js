const fs = require('fs');

/**
 * O ambiente do runner de migrations, lido e validado num lugar só.
 *
 * O runner roda com a credencial **master** do banco — é o único processo do
 * sistema que pode alterar schema e criar usuário. Por isso ele não aceita
 * configuração pela metade: qualquer coisa ausente ou estranha para a execução
 * antes de abrir conexão.
 *
 * Funções puras que recebem `env`, no mesmo padrão de backend/src/lib/config.js.
 */

/** Nome de usuário MySQL que aceitamos criar: sem aspas, sem espaço, sem surpresa. */
const NOME_USUARIO = /^[a-z_][a-z0-9_]{0,31}$/;

/** Abaixo disto a senha do usuário de aplicação não é gerada, é digitada. */
const SENHA_MINIMA = 16;

const obrigatorio = (env, chave) => {
  const valor = env[chave]?.trim();
  if (!valor) throw new Error(`${chave} não definido`);
  return valor;
};

/**
 * Configuração TLS — **mesma regra** de `backend/src/lib/config.js#dbSsl`.
 *
 * Copiada, e não importada, porque a imagem de `db/` é construída só com esta
 * pasta. Se uma mudar, a outra muda junto: o runner conecta ao mesmo RDS, com o
 * mesmo `require_secure_transport=ON`.
 */
function dbSsl(env = process.env, lerArquivo = fs.readFileSync) {
  if (env.DB_SSL?.trim() !== 'true') return undefined;

  const caminho = env.DB_SSL_CA_PATH?.trim();
  if (!caminho) {
    throw new Error('DB_SSL=true exige DB_SSL_CA_PATH apontando para o bundle da CA (RDS: global-bundle.pem)');
  }

  let ca;
  try {
    ca = lerArquivo(caminho, 'utf8');
  } catch (err) {
    throw new Error(`DB_SSL_CA_PATH aponta para "${caminho}", que não pôde ser lido: ${err.message}`);
  }

  return { ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' };
}

/**
 * O usuário que o backend usa para falar com o banco.
 *
 * Opcional: sem `APP_DB_PASS` o runner não mexe em usuário nenhum — é o caso do
 * Docker local, onde o backend conecta como root. Com a senha, o usuário é criado
 * se faltar e tem senha e permissões **reescritas** a cada execução: é assim que
 * uma rotação de segredo chega ao banco, e é assim que uma permissão concedida à
 * mão fora daqui some na próxima migração.
 */
function usuarioApp(env = process.env) {
  const senha = env.APP_DB_PASS;
  if (!senha) return null;

  const nome = env.APP_DB_USER?.trim() || 'manasync_app';
  if (!NOME_USUARIO.test(nome)) {
    throw new Error(`APP_DB_USER "${nome}" inválido: use minúsculas, dígitos e _ (até 32)`);
  }
  if (senha.length < SENHA_MINIMA) {
    throw new Error(`APP_DB_PASS precisa de pelo menos ${SENHA_MINIMA} caracteres`);
  }
  return { nome, senha };
}

function lerConfig(env = process.env, lerArquivo = fs.readFileSync) {
  const ssl = dbSsl(env, lerArquivo);
  const app = usuarioApp(env);

  const adminUser = obrigatorio(env, 'DB_ADMIN_USER');
  if (app && app.nome === adminUser) {
    throw new Error('APP_DB_USER não pode ser o usuário master: o objetivo é o app NÃO ter a credencial master');
  }

  const porta = Number(env.DB_PORT?.trim() || 3306);
  if (!Number.isInteger(porta) || porta <= 0) throw new Error(`DB_PORT inválida: "${env.DB_PORT}"`);

  const lock = Number(env.MIGRATE_LOCK_TIMEOUT_S?.trim() || 60);
  if (!Number.isInteger(lock) || lock < 1) {
    throw new Error(`MIGRATE_LOCK_TIMEOUT_S inválido: "${env.MIGRATE_LOCK_TIMEOUT_S}"`);
  }

  return {
    conexao: {
      host: obrigatorio(env, 'DB_HOST'),
      port: porta,
      user: adminUser,
      password: env.DB_ADMIN_PASS ?? '',
      database: obrigatorio(env, 'DB_NAME'),
      ssl,
    },
    usuarioApp: app,
    // Com TLS no servidor, o usuário de aplicação também é obrigado a usá-lo.
    exigirTlsDoApp: Boolean(ssl),
    adminEmail: env.ADMIN_EMAIL?.trim() || null,
    lockTimeoutS: lock,
  };
}

module.exports = { lerConfig, dbSsl, usuarioApp, NOME_USUARIO, SENHA_MINIMA };
