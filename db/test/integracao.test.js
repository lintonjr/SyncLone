/**
 * Integração contra um MySQL de verdade.
 *
 * No CI, o job `db` sobe um MySQL 8.4 e roda estes cenários com
 * `MIGRATE_IT_OBRIGATORIO=true` (ver .github/workflows/ci.yml). Localmente, sem
 * `MIGRATE_IT_HOST`, eles são pulados. Para rodar:
 *
 *   docker run -d --rm --name manasync-it -e MYSQL_ROOT_PASSWORD=itroot \
 *     -p 127.0.0.1:33084:3306 mysql:8.4
 *   MIGRATE_IT_HOST=127.0.0.1 MIGRATE_IT_PORT=33084 MIGRATE_IT_ROOT_PASS=itroot npm test
 *
 * Cada cenário cria seu próprio banco e seus próprios usuários, e apaga tudo no
 * fim: rodar de novo, ou em paralelo com outro cenário, não herda estado.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql2/promise');
const { executar } = require('../src/executar');

const HOST = process.env.MIGRATE_IT_HOST;
const PORT = Number(process.env.MIGRATE_IT_PORT || 3306);
const ROOT_PASS = process.env.MIGRATE_IT_ROOT_PASS ?? '';

// No CI a integração é obrigatória: pular em silêncio deixaria o job verde sem
// ter testado nada, e é exatamente o que um nome de variável errado causaria.
if (process.env.MIGRATE_IT_OBRIGATORIO === 'true' && !HOST) {
  throw new Error('MIGRATE_IT_OBRIGATORIO=true, mas MIGRATE_IT_HOST não foi definido: a integração não pode ser pulada');
}
const pular = !HOST && 'defina MIGRATE_IT_HOST para rodar a integração';

const REPO_DB = path.join(__dirname, '..');
const sufixo = () => crypto.randomBytes(4).toString('hex');
const silencioso = () => {
  const l = { linhas: [], avisos: [] };
  l.log = (m) => l.linhas.push(m);
  l.warn = (m) => l.avisos.push(m);
  return l;
};

const conectarRoot = (database) =>
  mysql.createConnection({ host: HOST, port: PORT, user: 'root', password: ROOT_PASS, database, multipleStatements: true });

/** Um banco novo, um diretório de migrations próprio (cópia do real) e a limpeza. */
async function ambiente(t) {
  const banco = `it_${sufixo()}`;
  const root = await conectarRoot();
  await root.query(`CREATE DATABASE ${banco} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-it-'));
  fs.cpSync(path.join(REPO_DB, 'init'), path.join(diretorio, 'init'), { recursive: true });
  fs.cpSync(path.join(REPO_DB, 'migrations'), path.join(diretorio, 'migrations'), { recursive: true });

  const usuarios = [];
  t.after(async () => {
    for (const u of usuarios) await root.query("DROP USER IF EXISTS ?@'%'", [u]);
    await root.query(`DROP DATABASE IF EXISTS ${banco}`);
    await root.end();
    fs.rmSync(diretorio, { recursive: true, force: true });
  });

  const config = (extra = {}) => ({
    conexao: { host: HOST, port: PORT, user: 'root', password: ROOT_PASS, database: banco },
    usuarioApp: null,
    exigirTlsDoApp: false,
    adminEmail: null,
    lockTimeoutS: 5,
    ...extra,
  });
  const rodar = (extra, comando = 'aplicar') => executar(config(extra), comando, { diretorio, log: silencioso() });
  const consultar = async (sql, params) => (await root.query(`USE ${banco}; ${sql}`, params))[0][1];

  return { banco, root, diretorio, rodar, consultar, usuarios };
}

const qtdMigrations = fs.readdirSync(path.join(REPO_DB, 'migrations')).filter((n) => n.endsWith('.sql')).length;

test('integração: banco vazio recebe schema e baseline; segunda execução não faz nada', { skip: pular }, async (t) => {
  const { rodar, consultar } = await ambiente(t);

  const primeira = await rodar();
  assert.equal(primeira.acao, 'schema-inicial');
  assert.equal(primeira.baseline.length, qtdMigrations);

  const tabelas = (await consultar('SHOW TABLES')).map((l) => Object.values(l)[0]);
  for (const esperada of ['users', 'events', 'pairings', 'badges', 'organizer_requests', 'schema_migrations']) {
    assert.ok(tabelas.includes(esperada), `tabela ${esperada} ausente`);
  }
  const modos = await consultar('SELECT modo, COUNT(*) AS n FROM schema_migrations GROUP BY modo');
  assert.deepEqual(modos.map((m) => [m.modo, Number(m.n)]), [['baseline', qtdMigrations]]);

  const segunda = await rodar();
  assert.equal(segunda.acao, 'migrar');
  assert.deepEqual(segunda.aplicadas, []);
});

test('integração: migration nova é aplicada e registrada; arquivo alterado é recusado', { skip: pular }, async (t) => {
  const { rodar, consultar, diretorio } = await ambiente(t);
  await rodar();

  fs.writeFileSync(
    path.join(diretorio, 'migrations', '900_it_coluna.sql'),
    'ALTER TABLE users ADD COLUMN it_marca int NULL;\nUPDATE users SET it_marca = 1;\n'
  );
  const r = await rodar();
  assert.deepEqual(r.aplicadas, ['900_it_coluna.sql']);
  const colunas = await consultar("SHOW COLUMNS FROM users LIKE 'it_marca'");
  assert.equal(colunas.length, 1);
  const [reg] = await consultar("SELECT modo FROM schema_migrations WHERE version = '900_it_coluna.sql'");
  assert.equal(reg.modo, 'aplicada');

  // Editar a migration já aplicada: o banco nunca vai ver o conteúdo novo.
  fs.appendFileSync(path.join(diretorio, 'migrations', '900_it_coluna.sql'), '-- editada depois\n');
  await assert.rejects(rodar(), /900_it_coluna\.sql/);
});

test('integração: migration quebrada para a execução; as anteriores ficam registradas', { skip: pular }, async (t) => {
  const { rodar, consultar, diretorio } = await ambiente(t);
  await rodar();

  fs.writeFileSync(path.join(diretorio, 'migrations', '901_it_boa.sql'), 'ALTER TABLE users ADD COLUMN it_boa int NULL;');
  fs.writeFileSync(path.join(diretorio, 'migrations', '902_it_quebrada.sql'), 'ALTER TABLE tabela_que_nao_existe ADD x int;');

  await assert.rejects(rodar(), /902_it_quebrada\.sql falhou/);
  const versoes = (await consultar('SELECT version FROM schema_migrations')).map((l) => l.version);
  assert.ok(versoes.includes('901_it_boa.sql'));
  assert.ok(!versoes.includes('902_it_quebrada.sql'));
});

test('integração: usuário de aplicação tem exatamente DML, e a rotação de senha chega ao banco', { skip: pular }, async (t) => {
  const { rodar, root, banco, usuarios } = await ambiente(t);
  const nome = `app_${sufixo()}`;
  usuarios.push(nome);
  const senha1 = crypto.randomBytes(24).toString('hex');
  const senha2 = crypto.randomBytes(24).toString('hex');

  await rodar({ usuarioApp: { nome, senha: senha1 } });

  const grants = async () => (await root.query("SHOW GRANTS FOR ?@'%'", [nome]))[0].map((l) => Object.values(l)[0]).sort();
  assert.deepEqual(await grants(), [
    `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${banco}\`.* TO \`${nome}\`@\`%\``,
    `GRANT USAGE ON *.* TO \`${nome}\`@\`%\``,
  ]);

  const comoApp = (senha) =>
    mysql.createConnection({ host: HOST, port: PORT, user: nome, password: senha, database: banco });

  const app = await comoApp(senha1);
  try {
    await app.query('SELECT COUNT(*) FROM users');
    await assert.rejects(app.query('CREATE TABLE it_invasora (id int)'), /denied/i);
    await assert.rejects(app.query('DROP TABLE users'), /denied/i);
    await assert.rejects(app.query('ALTER TABLE users ADD COLUMN x int'), /denied/i);
  } finally {
    await app.end();
  }

  // Alguém concede DROP à mão; a próxima migração, com senha nova, tira e troca.
  await root.query(`GRANT DROP ON \`${banco}\`.* TO ?@'%'`, [nome]);
  await rodar({ usuarioApp: { nome, senha: senha2 } });
  assert.ok(!(await grants()).some((g) => g.includes('DROP')), 'DROP concedido à mão deveria ter sido revogado');
  await assert.rejects(comoApp(senha1), /denied/i);
  const novo = await comoApp(senha2);
  await novo.end();
});

test('integração: admin inicial só promove enquanto não houver admin', { skip: pular }, async (t) => {
  const { rodar, consultar } = await ambiente(t);
  await rodar();

  const inserir = (id, email) =>
    consultar('INSERT INTO users (id, display_name, email, password_hash) VALUES (?, ?, ?, ?)', [id, id, email, 'x']);
  await inserir('dono', 'dono@x.com');
  await inserir('intruso', 'intruso@x.com');

  assert.equal((await rodar({ adminEmail: 'ninguem@x.com' })).admin, 'sem-conta');
  assert.equal((await rodar({ adminEmail: 'dono@x.com' })).admin, 'promovido');
  assert.equal((await rodar({ adminEmail: 'dono@x.com' })).admin, 'ja-admin');
  assert.equal((await rodar({ adminEmail: 'intruso@x.com' })).admin, 'ja-existe-admin');

  const papeis = await consultar('SELECT id, role FROM users ORDER BY id');
  assert.deepEqual(papeis.map((p) => [p.id, p.role]), [['dono', 'admin'], ['intruso', 'player']]);
});

test('integração: banco existente sem histórico exige baseline explícito', { skip: pular }, async (t) => {
  const { rodar, root, banco, consultar } = await ambiente(t);

  // O banco do Docker local de antes do runner: schema aplicado pelo initdb.
  await root.query(`USE ${banco}; ${fs.readFileSync(path.join(REPO_DB, 'init', '01-schema.sql'), 'utf8')}`);

  await assert.rejects(rodar(), /baseline/);
  const b = await rodar({}, 'baseline');
  assert.equal(b.baseline.length, qtdMigrations);
  const [{ n }] = await consultar("SELECT COUNT(*) AS n FROM schema_migrations WHERE modo = 'baseline'");
  assert.equal(Number(n), qtdMigrations);
  assert.deepEqual((await rodar()).aplicadas, []);
});

test('integração: com o lock ocupado, a execução falha em vez de disputar', { skip: pular }, async (t) => {
  const { rodar } = await ambiente(t);
  const outra = await conectarRoot();
  t.after(() => outra.end());
  await outra.query("SELECT GET_LOCK('manasync_migrate', 10)");

  await assert.rejects(rodar({ lockTimeoutS: 1 }), /outra migração está rodando/);

  await outra.query("SELECT RELEASE_LOCK('manasync_migrate')");
  assert.equal((await rodar()).acao, 'schema-inicial');
});
