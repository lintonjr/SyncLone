const test = require('node:test');
const assert = require('node:assert');
const { lerConfig, usuarioApp, dbSsl } = require('../src/config');

const BASE = {
  DB_HOST: 'banco',
  DB_NAME: 'manasync',
  DB_ADMIN_USER: 'manasync_admin',
  DB_ADMIN_PASS: 'segredo-master',
};

test('config: mínimo necessário, com padrões', () => {
  const c = lerConfig(BASE);
  assert.equal(c.conexao.host, 'banco');
  assert.equal(c.conexao.port, 3306);
  assert.equal(c.conexao.ssl, undefined);
  assert.equal(c.usuarioApp, null);
  assert.equal(c.adminEmail, null);
  assert.equal(c.lockTimeoutS, 60);
  assert.equal(c.exigirTlsDoApp, false);
});

test('config: falta host, banco ou usuário master → não roda', () => {
  for (const chave of ['DB_HOST', 'DB_NAME', 'DB_ADMIN_USER']) {
    assert.throws(() => lerConfig({ ...BASE, [chave]: '' }), new RegExp(chave));
  }
});

test('config: porta e timeout de lock inválidos não viram padrão em silêncio', () => {
  assert.throws(() => lerConfig({ ...BASE, DB_PORT: 'mysql' }), /DB_PORT/);
  assert.throws(() => lerConfig({ ...BASE, MIGRATE_LOCK_TIMEOUT_S: '0' }), /MIGRATE_LOCK_TIMEOUT_S/);
});

test('config: com TLS, o usuário de aplicação também é obrigado a usar TLS', () => {
  const c = lerConfig(
    { ...BASE, DB_SSL: 'true', DB_SSL_CA_PATH: '/certs/rds.pem', APP_DB_PASS: 'x'.repeat(32) },
    () => '---PEM---'
  );
  assert.equal(c.conexao.ssl.rejectUnauthorized, true);
  assert.equal(c.exigirTlsDoApp, true);
});

test('config: TLS sem CA não roda (mesma regra do backend)', () => {
  assert.throws(() => dbSsl({ DB_SSL: 'true' }), /DB_SSL_CA_PATH/);
});

test('usuário app: sem senha, o runner não mexe em usuário (Docker local)', () => {
  assert.equal(usuarioApp({}), null);
});

test('usuário app: padrão manasync_app', () => {
  assert.deepEqual(usuarioApp({ APP_DB_PASS: 'x'.repeat(16) }), { nome: 'manasync_app', senha: 'x'.repeat(16) });
});

test('usuário app: senha curta é recusada', () => {
  assert.throws(() => usuarioApp({ APP_DB_PASS: 'curta' }), /16/);
});

test('usuário app: nome com aspas, espaço ou maiúscula é recusado', () => {
  for (const nome of ["app'--", 'app user', 'App', 'a'.repeat(33), '1app']) {
    assert.throws(() => usuarioApp({ APP_DB_USER: nome, APP_DB_PASS: 'x'.repeat(16) }), /APP_DB_USER/, nome);
  }
});

test('usuário app: não pode ser o próprio master', () => {
  // Configurar o app com o nome do master "rebaixaria" o master a DML-only.
  assert.throws(
    () => lerConfig({ ...BASE, APP_DB_USER: 'manasync_admin', APP_DB_PASS: 'x'.repeat(16) }),
    /master/
  );
});

test('admin: e-mail com espaços é aparado; vazio é nulo', () => {
  assert.equal(lerConfig({ ...BASE, ADMIN_EMAIL: '  dono@x.com ' }).adminEmail, 'dono@x.com');
  assert.equal(lerConfig({ ...BASE, ADMIN_EMAIL: '   ' }).adminEmail, null);
});
