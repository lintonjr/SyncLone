const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { valkeyConfig } = require('../src/lib/config');
const { criarClientes, criarBarramento, observar, opcoesCluster } = require('../src/lib/valkey');

// --- configuração ---

test('valkey config: sem URL, desligado', () => {
  assert.equal(valkeyConfig({}), null);
  assert.equal(valkeyConfig({ VALKEY_URL: '  ' }), null);
});

test('valkey config: local, sem TLS nem cluster', () => {
  assert.deepEqual(valkeyConfig({ VALKEY_URL: 'redis://valkey:6379' }), {
    host: 'valkey',
    port: 6379,
    tls: false,
    cluster: false,
    username: undefined,
    password: undefined,
  });
});

test('valkey config: produção — rediss, cluster, credencial das variáveis', () => {
  const c = valkeyConfig({
    VALKEY_URL: 'rediss://manasync-x.serverless.use2.cache.amazonaws.com:6379',
    VALKEY_CLUSTER: 'true',
    VALKEY_USER: 'manasync-app',
    VALKEY_PASS: 'segredo',
  });
  assert.equal(c.tls, true);
  assert.equal(c.cluster, true);
  assert.equal(c.host, 'manasync-x.serverless.use2.cache.amazonaws.com');
  assert.equal(c.username, 'manasync-app');
  assert.equal(c.password, 'segredo');
});

test('valkey config: porta padrão 6379', () => {
  assert.equal(valkeyConfig({ VALKEY_URL: 'redis://valkey' }).port, 6379);
});

test('valkey config: cluster sem TLS é recusado (o Serverless só fala TLS)', () => {
  assert.throws(() => valkeyConfig({ VALKEY_URL: 'redis://x:6379', VALKEY_CLUSTER: 'true' }), /rediss/);
});

test('valkey config: senha na URL é recusada', () => {
  assert.throws(() => valkeyConfig({ VALKEY_URL: 'rediss://app:segredo@x:6379' }), /VALKEY_PASS/);
});

test('valkey config: protocolo ou URL inválidos não sobem', () => {
  assert.throws(() => valkeyConfig({ VALKEY_URL: 'http://x:6379' }), /protocolo/);
  assert.throws(() => valkeyConfig({ VALKEY_URL: 'não é url' }), /inválida/);
});

// --- clientes ---

test('clientes: opções de cluster são as validadas no spike do PR 3', () => {
  const o = opcoesCluster({ host: 'h.cache.amazonaws.com', port: 6379, username: 'u', password: 'p' });
  assert.equal(o.shardedSubscribers, true);
  assert.equal(o.redisOptions.tls.servername, 'h.cache.amazonaws.com');
  assert.equal(o.redisOptions.username, 'u');
  // Resolver para IP quebraria a verificação do certificado.
  o.dnsLookup('h.cache.amazonaws.com', (err, endereco) => assert.equal(endereco, 'h.cache.amazonaws.com'));
  // Ready check ligado (é o motivo do +cluster|info na permissão).
  assert.notEqual(o.enableReadyCheck, false);
  assert.notEqual(o.redisOptions.enableReadyCheck, false);
});

test('clientes: dois clientes separados, do tipo certo para cada modo', () => {
  const criados = [];
  class Simples extends EventEmitter { constructor(o) { super(); criados.push(['simples', o]); } }
  class Cluster extends EventEmitter { constructor(n, o) { super(); criados.push(['cluster', n, o]); } }
  const log = { log() {}, warn() {} };

  const local = criarClientes({ host: 'valkey', port: 6379, tls: false, cluster: false }, { log, Simples, Cluster });
  assert.notEqual(local.comandos, local.assinante);
  assert.deepEqual(criados.map((c) => c[0]), ['simples', 'simples']);
  assert.equal(criados[0][1].tls, undefined);

  criados.length = 0;
  criarClientes({ host: 'h', port: 6379, tls: true, cluster: true }, { log, Simples, Cluster });
  assert.deepEqual(criados.map((c) => c[0]), ['cluster', 'cluster']);
  assert.deepEqual(criados[0][1], [{ host: 'h', port: 6379 }]);
});

test('observação: conexão fechada logo após conectar vira aviso de credencial', () => {
  let agora = 0;
  const avisos = [];
  const cliente = new EventEmitter();
  observar(cliente, 'comandos', { log: { log() {}, warn: (m) => avisos.push(m) }, agora: () => agora });

  cliente.emit('connect');
  agora = 300;
  cliente.emit('close');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /VALKEY_USER\/VALKEY_PASS/);
});

test('observação: erro repetido não inunda o log', () => {
  let agora = 0;
  const avisos = [];
  const cliente = new EventEmitter();
  observar(cliente, 'assinante', { log: { log() {}, warn: (m) => avisos.push(m) }, agora: () => agora });

  for (let i = 0; i < 50; i++) cliente.emit('error', new Error('ECONNREFUSED'));
  assert.equal(avisos.length, 1);
  agora = 31000;
  cliente.emit('error', new Error('ECONNREFUSED'));
  assert.equal(avisos.length, 2);
});

test('observação: conexão que ficou pronta e caiu depois não é tratada como credencial', () => {
  let agora = 0;
  const avisos = [];
  const cliente = new EventEmitter();
  observar(cliente, 'comandos', { log: { log() {}, warn: (m) => avisos.push(m) }, agora: () => agora });

  cliente.emit('connect');
  cliente.emit('ready');
  agora = 500;
  cliente.emit('close');
  assert.equal(avisos.length, 0);
});

// --- barramento ---

test('barramento: traduz para SPUBLISH/SSUBSCRIBE/SUNSUBSCRIBE e escuta smessage', async () => {
  const chamadas = [];
  const comandos = { spublish: async (...a) => { chamadas.push(['spublish', ...a]); return 1; } };
  const assinante = new EventEmitter();
  assinante.ssubscribe = async (c) => chamadas.push(['ssubscribe', c]);
  assinante.sunsubscribe = async (c) => chamadas.push(['sunsubscribe', c]);

  const b = criarBarramento({ comandos, assinante }, { log: { warn() {} } });
  await b.publicar('evento:1', 'm');
  await b.assinar('evento:1');
  await b.desassinar('evento:1');
  let recebido;
  b.aoReceber((canal, msg) => { recebido = [canal, msg]; });
  assinante.emit('smessage', 'evento:1', 'oi');

  assert.deepEqual(chamadas, [['spublish', 'evento:1', 'm'], ['ssubscribe', 'evento:1'], ['sunsubscribe', 'evento:1']]);
  assert.deepEqual(recebido, ['evento:1', 'oi']);
});

test('barramento: falha do Valkey vira aviso, nunca rejeição para quem chamou', async () => {
  const avisos = [];
  const quebrado = async () => { throw new Error('Connection is closed.'); };
  const assinante = new EventEmitter();
  assinante.ssubscribe = quebrado;
  assinante.sunsubscribe = quebrado;
  const b = criarBarramento({ comandos: { spublish: quebrado }, assinante }, { log: { warn: (m) => avisos.push(m) } });

  await b.publicar('evento:1', 'm');
  await b.assinar('evento:1');
  await b.desassinar('evento:1');
  assert.equal(avisos.length, 3);
});
