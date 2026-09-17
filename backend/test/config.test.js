const test = require('node:test');
const assert = require('node:assert');
const {
  corsOrigins,
  trustProxy,
  dbSsl,
  sseHeartbeatMs,
  jwtSecret,
  segredosOrigem,
  ORIGENS_DEV,
} = require('../src/lib/config');

// --- CORS ---

test('cors: sem variável, vale o par de desenvolvimento', () => {
  assert.deepEqual(corsOrigins({}), ORIGENS_DEV);
  assert.deepEqual(corsOrigins({ CORS_ORIGINS: '   ' }), ORIGENS_DEV);
});

test('cors: lista separada por vírgula, com espaços tolerados', () => {
  assert.deepEqual(
    corsOrigins({ CORS_ORIGINS: 'https://a.com, https://b.com' }),
    ['https://a.com', 'https://b.com']
  );
});

test('cors: vazio em produção é resposta legítima, não engano', () => {
  // Com SPA e API na mesma origem não há chamada cross-origin: a lista vazia é
  // o estado correto, e o teste existe para ninguém "consertar" isso para `*`.
  assert.deepEqual(corsOrigins({ CORS_ORIGINS: ',,' }), []);
});

test('cors: vazio em produção não herda as origens de desenvolvimento', () => {
  // O CDK manda CORS_ORIGINS='' de propósito. Antes, esse vazio caía no par de
  // localhost com credenciais — no site publicado.
  assert.equal(corsOrigins({ NODE_ENV: 'production' }), false);
  assert.equal(corsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: '' }), false);
  assert.equal(corsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: '  ' }), false);
});

test('cors: produção ainda aceita lista explícita', () => {
  assert.deepEqual(
    corsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: 'https://a.com' }),
    ['https://a.com']
  );
});

test('cors: * só quando pedido explicitamente', () => {
  assert.equal(corsOrigins({ CORS_ORIGINS: '*' }), '*');
  assert.notEqual(corsOrigins({}), '*');
});

// --- trust proxy ---

test('trust proxy: padrão de um salto', () => {
  assert.equal(trustProxy({}), 1);
});

test('trust proxy: o número do ambiente vence', () => {
  assert.equal(trustProxy({ TRUST_PROXY: '2' }), 2);
  assert.equal(trustProxy({ TRUST_PROXY: '0' }), 0);
});

test('trust proxy: lixo não vira silenciosamente 0 nem NaN', () => {
  // Um NaN aqui faria o Express tratar todo mundo como vindo do proxy, e o
  // limitador de senha passaria a ser global. Falhar alto é o único caminho.
  assert.throws(() => trustProxy({ TRUST_PROXY: 'sim' }), /TRUST_PROXY/);
  assert.throws(() => trustProxy({ TRUST_PROXY: '-1' }), /TRUST_PROXY/);
  assert.throws(() => trustProxy({ TRUST_PROXY: '1.5' }), /TRUST_PROXY/);
});

// --- TLS do banco ---

test('db ssl: desligado por padrão — o MySQL local não fala TLS', () => {
  assert.equal(dbSsl({}), undefined);
  assert.equal(dbSsl({ DB_SSL: 'false' }), undefined);
});

test('db ssl: ligado, lê a CA e exige verificação do servidor', () => {
  const ssl = dbSsl({ DB_SSL: 'true', DB_SSL_CA_PATH: '/certs/rds.pem' }, () => '---PEM---');
  assert.equal(ssl.ca, '---PEM---');
  // Cifrar sem verificar aceitaria qualquer servidor que se dissesse o banco.
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.minVersion, 'TLSv1.2');
});

test('db ssl: ligado sem CA não sobe', () => {
  assert.throws(() => dbSsl({ DB_SSL: 'true' }), /DB_SSL_CA_PATH/);
});

test('db ssl: CA ilegível não vira aviso, vira parada', () => {
  // O modo de falhar que importa: subir com TLS desligado depois de alguém ter
  // pedido TLS é o defeito que roda meses sem ninguém ver.
  const quebrado = () => { throw new Error('ENOENT'); };
  assert.throws(
    () => dbSsl({ DB_SSL: 'true', DB_SSL_CA_PATH: '/nao/existe.pem' }, quebrado),
    /não pôde ser lido/
  );
});

// --- heartbeat do SSE ---

test('heartbeat: padrão de 15s cabe com folga no limite de 30s do CloudFront', () => {
  assert.equal(sseHeartbeatMs({}), 15000);
  assert.ok(sseHeartbeatMs({}) * 2 <= 30000, 'dois heartbeats precisam caber na janela');
});

test('heartbeat: configurável, mas não abaixo de um segundo', () => {
  assert.equal(sseHeartbeatMs({ SSE_HEARTBEAT_MS: '20000' }), 20000);
  assert.throws(() => sseHeartbeatMs({ SSE_HEARTBEAT_MS: '500' }), /SSE_HEARTBEAT_MS/);
  assert.throws(() => sseHeartbeatMs({ SSE_HEARTBEAT_MS: 'rápido' }), /SSE_HEARTBEAT_MS/);
});

// --- JWT ---

const SEGREDO_LONGO = 'x'.repeat(32);

test('jwt: sem segredo o processo não sobe, em qualquer ambiente', () => {
  assert.throws(() => jwtSecret({}), /JWT_SECRET/);
  assert.throws(() => jwtSecret({ JWT_SECRET: '   ' }), /JWT_SECRET/);
  assert.throws(() => jwtSecret({ NODE_ENV: 'production' }), /JWT_SECRET/);
});

test('jwt: em produção, segredo curto é recusado', () => {
  assert.throws(() => jwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(31) }), /32/);
  assert.equal(jwtSecret({ NODE_ENV: 'production', JWT_SECRET: SEGREDO_LONGO }), SEGREDO_LONGO);
});

test('jwt: fora de produção, segredo curto ainda serve', () => {
  assert.equal(jwtSecret({ JWT_SECRET: 'dev' }), 'dev');
});

test('jwt: o valor volta intacto, sem trim', () => {
  // Aparar mudaria a chave e invalidaria todo token já emitido.
  assert.equal(jwtSecret({ JWT_SECRET: ` ${SEGREDO_LONGO} ` }), ` ${SEGREDO_LONGO} `);
});

// --- segredo de origem ---

test('origem: sem variável, verificação desligada', () => {
  assert.deepEqual(segredosOrigem({}), []);
  assert.deepEqual(segredosOrigem({ ORIGIN_VERIFY_ATUAL: '  ' }), []);
});

test('origem: atual sozinho, ou atual e anterior durante a rotação', () => {
  const a = 'a'.repeat(32);
  const b = 'b'.repeat(40);
  assert.deepEqual(segredosOrigem({ ORIGIN_VERIFY_ATUAL: a }), [a]);
  assert.deepEqual(segredosOrigem({ ORIGIN_VERIFY_ATUAL: a, ORIGIN_VERIFY_ANTERIOR: b }), [a, b]);
});

test('origem: anterior sem atual é rotação pela metade, e não sobe', () => {
  assert.throws(() => segredosOrigem({ ORIGIN_VERIFY_ANTERIOR: 'b'.repeat(32) }), /rotação/);
});

test('origem: segredo curto não sobe', () => {
  assert.throws(() => segredosOrigem({ ORIGIN_VERIFY_ATUAL: 'curto' }), /32/);
  assert.throws(
    () => segredosOrigem({ ORIGIN_VERIFY_ATUAL: 'a'.repeat(32), ORIGIN_VERIFY_ANTERIOR: 'curto' }),
    /32/
  );
});
