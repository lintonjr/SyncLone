/**
 * Integração contra um Valkey de verdade.
 *
 * No CI, o job `backend` sobe um Valkey 8.1 e roda estes cenários com
 * `VALKEY_IT_OBRIGATORIO=true` (ver .github/workflows/ci.yml). Localmente, sem
 * `VALKEY_IT_URL`, eles são pulados. Para rodar:
 *
 *   docker run -d --rm --name manasync-valkey-it -p 127.0.0.1:36379:6379 valkey/valkey:8.1-alpine
 *   VALKEY_IT_URL=redis://127.0.0.1:36379 npm test
 *
 * O modo cluster com TLS e RBAC do ElastiCache Serverless foi validado à parte,
 * no spike do PR 3; aqui o que se prova é o comportamento do código — duas tasks
 * conversando pelo barramento e o contador do rate limit — contra o servidor real.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { valkeyConfig } = require('../src/lib/config');
const { criarClientes, criarBarramento } = require('../src/lib/valkey');
const { criarEventStream } = require('../src/services/eventStream');
const { ValkeyStore } = require('../src/lib/rateLimitStore');

const URL_IT = process.env.VALKEY_IT_URL;
if (process.env.VALKEY_IT_OBRIGATORIO === 'true' && !URL_IT) {
  throw new Error('VALKEY_IT_OBRIGATORIO=true, mas VALKEY_IT_URL não foi definido: a integração não pode ser pulada');
}
const pular = !URL_IT && 'defina VALKEY_IT_URL para rodar a integração';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const silencioso = { log() {}, warn() {} };

async function aguardar(condicao, prazoMs = 3000) {
  const limite = Date.now() + prazoMs;
  while (!condicao()) {
    if (Date.now() > limite) return false;
    await esperar(20);
  }
  return true;
}

/** Uma "task": clientes próprios, barramento próprio, registro próprio. */
async function umaTask(t) {
  const clientes = criarClientes(valkeyConfig({ VALKEY_URL: URL_IT }), { log: silencioso });
  t.after(() => {
    clientes.comandos.disconnect();
    clientes.assinante.disconnect();
  });
  await clientes.comandos.ping();
  const stream = criarEventStream({ log: silencioso });
  stream.usarBarramento(criarBarramento(clientes, { log: silencioso }));
  return { stream, clientes };
}

const umCliente = () => {
  const c = { escrito: [] };
  c.write = (txt) => c.escrito.push(txt);
  c.end = () => {};
  return c;
};

test('valkey real: broadcast numa task chega ao cliente conectado na outra, uma vez', { skip: pular }, async (t) => {
  const a = await umaTask(t);
  const b = await umaTask(t);
  const evento = `it-${crypto.randomUUID()}`;

  const clienteEmA = umCliente();
  const clienteEmB = umCliente();
  a.stream.subscribe(evento, clienteEmA);
  b.stream.subscribe(evento, clienteEmB);
  await esperar(300); // SSUBSCRIBE não é aguardado pelo subscribe (é fogo-e-esquece)

  a.stream.broadcast(evento);
  assert.ok(await aguardar(() => clienteEmB.escrito.length === 1), 'o cliente da outra task não recebeu');
  assert.deepEqual(clienteEmB.escrito, ['data: update\n\n']);

  await esperar(300); // tempo para um eco indevido aparecer
  assert.deepEqual(clienteEmA.escrito, ['data: update\n\n'], 'a task de origem não pode entregar duas vezes');
});

test('valkey real: "deleted" viaja com o tipo certo', { skip: pular }, async (t) => {
  const a = await umaTask(t);
  const b = await umaTask(t);
  const evento = `it-${crypto.randomUUID()}`;
  const cliente = umCliente();
  b.stream.subscribe(evento, cliente);
  await esperar(300);

  a.stream.broadcast(evento, 'deleted');
  assert.ok(await aguardar(() => cliente.escrito.length === 1));
  assert.deepEqual(cliente.escrito, ['data: deleted\n\n']);
});

test('valkey real: depois que o último cliente sai, a task para de receber', { skip: pular }, async (t) => {
  const a = await umaTask(t);
  const b = await umaTask(t);
  const evento = `it-${crypto.randomUUID()}`;
  const cliente = umCliente();
  b.stream.subscribe(evento, cliente);
  await esperar(300);
  b.stream.unsubscribe(evento, cliente);
  await esperar(300);

  // SPUBLISH devolve quantos assinantes receberam: nenhum.
  const receptores = await a.clientes.comandos.spublish(`evento:${evento}`, JSON.stringify({ origem: 'x', kind: 'update' }));
  assert.equal(receptores, 0);
});

test('valkey real: store do rate limit — contagem, janela fixa, decremento e reset', { skip: pular }, async (t) => {
  const { clientes } = await umaTask(t);
  const store = new ValkeyStore({ cliente: clientes.comandos, prefixo: `rl:it-${crypto.randomUUID()}:` });
  store.init({ windowMs: 60000 });
  const chave = '198.51.100.7:vitima@x.com';
  // Sem t.after para a limpeza: os hooks rodam na ordem de registro, e o da
  // desconexão (registrado em umaTask) viria antes. O próprio teste termina com
  // resetKey, que é a limpeza.

  assert.equal((await store.increment(chave)).totalHits, 1);
  const ttl1 = await clientes.comandos.pttl(store.chave(chave));
  await esperar(1100);
  const r2 = await store.increment(chave);
  assert.equal(r2.totalHits, 2);
  const ttl2 = await clientes.comandos.pttl(store.chave(chave));
  assert.ok(ttl2 < ttl1 - 900, `o NX não pode renovar a janela (ttl1=${ttl1}, ttl2=${ttl2})`);
  assert.ok(r2.resetTime > new Date());

  await store.decrement(chave);
  assert.equal((await store.increment(chave)).totalHits, 2);

  await store.resetKey(chave);
  assert.equal(await clientes.comandos.exists(store.chave(chave)), 0);

  // Decremento com a chave já expirada/apagada não deixa -1 para trás.
  await store.decrement(chave);
  assert.equal(await clientes.comandos.exists(store.chave(chave)), 0);
});
