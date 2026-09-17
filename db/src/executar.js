const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { listarMigrations, planejar } = require('./plano');

const DIR_PADRAO = path.join(__dirname, '..');
const NOME_LOCK = 'manasync_migrate';

const TABELA_HISTORICO = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    varchar(255) NOT NULL,
    checksum   char(64)     NOT NULL,
    modo       enum('aplicada','baseline') NOT NULL,
    applied_at datetime(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/**
 * Uma execução completa do runner.
 *
 * A ordem é a que mantém o banco explicável depois de qualquer falha:
 *
 *   1. lock nomeado do MySQL — duas execuções simultâneas (um deploy repetido,
 *      duas pessoas) nunca aplicam a mesma migration duas vezes;
 *   2. schema ou migrations, **uma por vez**, cada uma registrada logo depois de
 *      aplicada. DDL no MySQL não é transacional: se a 3ª de 5 falhar, o
 *      histórico diz exatamente que 1 e 2 entraram e a 3 não;
 *   3. usuário de aplicação — depois do schema, porque o GRANT é sobre ele;
 *   4. admin inicial — por último, porque precisa da tabela `users`.
 *
 * `diretorio`, `log` e `conectar` existem para os testes.
 */
async function executar(config, comando = 'aplicar', {
  diretorio = DIR_PADRAO,
  log = console,
  conectar = mysql.createConnection,
} = {}) {
  const conn = await conectar({
    ...config.conexao,
    // Só esta conexão executa arquivos com vários comandos; o backend nunca.
    multipleStatements: true,
    timezone: '+00:00',
    charset: 'utf8mb4_unicode_ci',
  });

  let travado = false;
  try {
    const [[{ ok }]] = await conn.query('SELECT GET_LOCK(?, ?) AS ok', [NOME_LOCK, config.lockTimeoutS]);
    if (ok !== 1) {
      throw new Error(`outra migração está rodando (lock "${NOME_LOCK}" ocupado por ${config.lockTimeoutS}s)`);
    }
    travado = true;

    await conn.query(TABELA_HISTORICO);

    const arquivos = listarMigrations(path.join(diretorio, 'migrations'));
    const [linhas] = await conn.query('SELECT version, checksum FROM schema_migrations');
    const registradas = new Map(linhas.map((l) => [l.version, l.checksum]));
    const [[{ total }]] = await conn.query(
      "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'users'"
    );

    const plano = planejar({ temTabelas: Number(total) > 0, registradas, arquivos }, comando);
    for (const orfa of plano.orfas ?? []) {
      log.warn(`[migrate] ${orfa} está registrada no banco mas não existe em db/migrations`);
    }

    const resumo = { acao: plano.acao, aplicadas: [], baseline: [] };

    switch (plano.acao) {
      case 'erro':
        throw new Error(plano.motivo);

      case 'schema-inicial': {
        log.log('[migrate] banco vazio: aplicando init/01-schema.sql');
        await conn.query(fs.readFileSync(path.join(diretorio, 'init', '01-schema.sql'), 'utf8'));
        await registrar(conn, plano.registrar, 'baseline');
        resumo.baseline = plano.registrar.map((a) => a.versao);
        break;
      }

      case 'baseline':
        await registrar(conn, plano.registrar, 'baseline');
        resumo.baseline = plano.registrar.map((a) => a.versao);
        break;

      case 'migrar':
        for (const migration of plano.aplicar) {
          log.log(`[migrate] aplicando ${migration.versao}`);
          try {
            await conn.query(migration.sql);
          } catch (err) {
            throw new Error(
              `${migration.versao} falhou: ${err.message}. As anteriores ficaram aplicadas e registradas; ` +
                'DDL do MySQL não desfaz o que já executou — confira o banco (ou o snapshot) antes de repetir.'
            );
          }
          await registrar(conn, [migration], 'aplicada');
          resumo.aplicadas.push(migration.versao);
        }
        break;

      default:
        throw new Error(`plano desconhecido: ${plano.acao}`);
    }

    if (config.usuarioApp) {
      await garantirUsuarioApp(conn, config);
      log.log(`[migrate] usuário ${config.usuarioApp.nome} garantido (SELECT, INSERT, UPDATE, DELETE)`);
      resumo.usuarioApp = config.usuarioApp.nome;
    }

    if (config.adminEmail) {
      resumo.admin = await promoverAdminInicial(conn, config.adminEmail, log);
    }

    log.log(`[migrate] ${JSON.stringify(resumo)}`);
    return resumo;
  } finally {
    if (travado) await conn.query('SELECT RELEASE_LOCK(?)', [NOME_LOCK]).catch(() => {});
    await conn.end().catch(() => {});
  }
}

async function registrar(conn, migrations, modo) {
  for (const m of migrations) {
    await conn.query('INSERT INTO schema_migrations (version, checksum, modo) VALUES (?, ?, ?)', [
      m.versao,
      m.checksum,
      modo,
    ]);
  }
}

/**
 * O usuário com que o backend conecta: só DML, só neste banco.
 *
 * `REVOKE ALL` antes do `GRANT` é o que torna a permissão **exata**, e não
 * cumulativa: se alguém concedeu `DROP` à mão num dia de pressa, a próxima
 * migração tira. O `ALTER USER` reescreve a senha sempre, e é por ele que a
 * rotação do segredo chega ao banco.
 *
 * Sem DDL de propósito: o backend não cria nem altera tabela em runtime
 * (verificado), então uma falha explorável na API não vira `DROP TABLE`.
 */
async function garantirUsuarioApp(conn, config) {
  const { nome, senha } = config.usuarioApp;
  const tls = config.exigirTlsDoApp ? ' REQUIRE SSL' : ' REQUIRE NONE';
  const banco = mysql.escapeId(config.conexao.database);

  await conn.query(`CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?${tls}`, [nome, senha]);
  await conn.query(`ALTER USER ?@'%' IDENTIFIED BY ?${tls}`, [nome, senha]);
  await conn.query("REVOKE ALL PRIVILEGES, GRANT OPTION FROM ?@'%'", [nome]);
  await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${banco}.* TO ?@'%'`, [nome]);
}

/**
 * O primeiro dono da plataforma — mesma regra de backend/src/lib/bootstrapAdmin.js.
 *
 * Em produção, é **aqui** que a promoção acontece, e não na subida do backend:
 * a task do serviço não recebe `ADMIN_EMAIL`, então uma falha na API não tem
 * como promover ninguém. A trava é a mesma: só enquanto não existir admin.
 */
async function promoverAdminInicial(conn, email, log) {
  const [[usuario]] = await conn.query('SELECT id, role FROM users WHERE email = ?', [email]);
  if (!usuario) {
    log.warn(`[migrate] ADMIN_EMAIL=${email} ainda não tem conta — crie a conta no site e rode a migração de novo`);
    return 'sem-conta';
  }
  if (usuario.role === 'admin') return 'ja-admin';

  const [[{ total }]] = await conn.query("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'");
  if (Number(total) > 0) {
    log.warn(`[migrate] já existe admin; ADMIN_EMAIL=${email} não é aplicado`);
    return 'ja-existe-admin';
  }

  await conn.query("UPDATE users SET role = 'admin' WHERE id = ?", [usuario.id]);
  log.log(`[migrate] ${email} promovido a admin (primeiro dono da plataforma)`);
  return 'promovido';
}

module.exports = { executar, garantirUsuarioApp, promoverAdminInicial, NOME_LOCK };
