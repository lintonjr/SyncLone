const test = require('node:test');
const assert = require('node:assert');
const { criarEventStream } = require('../src/services/eventStream');

const umCliente = () => {
  const c = { escrito: [] };
  c.write = (t) => c.escrito.push(t);
  c.end = () => {};
  return c;
};

const silencioso = () => {
  const l = { avisos: [] };
  l.warn = (m) => l.avisos.push(m);
  return l;
};

/** Barramento falso: guarda o que foi pedido e deixa o teste entregar mensagens. */
function umBarramento() {
  const b = { publicadas: [], assinaturas: [], desassinaturas: [], receber: null };
  b.publicar = (canal, msg) => b.publicadas.push([canal, msg]);
  b.assinar = (canal) => b.assinaturas.push(canal);
  b.desassinar = (canal) => b.desassinaturas.push(canal);
  b.aoReceber = (fn) => { b.receber = fn; };
  return b;
}

test('barramento: primeiro assinante assina o canal; os seguintes não repetem', () => {
  const s = criarEventStream({ log: silencioso() });
  const b = umBarramento();
  s.usarBarramento(b);

  s.subscribe('ev1', umCliente());
  s.subscribe('ev1', umCliente());
  s.subscribe('ev2', umCliente());
  assert.deepEqual(b.assinaturas, ['evento:ev1', 'evento:ev2']);
});

test('barramento: último a sair desassina; enquanto sobra alguém, não', () => {
  const s = criarEventStream({ log: silencioso() });
  const b = umBarramento();
  s.usarBarramento(b);
  const a = umCliente();
  const c = umCliente();
  s.subscribe('ev1', a);
  s.subscribe('ev1', c);

  s.unsubscribe('ev1', a);
  assert.deepEqual(b.desassinaturas, []);
  s.unsubscribe('ev1', c);
  assert.deepEqual(b.desassinaturas, ['evento:ev1']);
});

test('barramento: broadcast entrega aqui na hora e publica com a origem', () => {
  const s = criarEventStream({ log: silencioso(), origem: 'task-a' });
  const b = umBarramento();
  s.usarBarramento(b);
  const local = umCliente();
  s.subscribe('ev1', local);

  s.broadcast('ev1', 'deleted');
  assert.deepEqual(local.escrito, ['data: deleted\n\n']);
  assert.deepEqual(b.publicadas, [['evento:ev1', JSON.stringify({ origem: 'task-a', kind: 'deleted' })]]);
});

test('barramento: mensagem de outra task chega aos clientes daqui', () => {
  const s = criarEventStream({ log: silencioso(), origem: 'task-b' });
  const b = umBarramento();
  s.usarBarramento(b);
  const cliente = umCliente();
  s.subscribe('ev1', cliente);

  b.receber('evento:ev1', JSON.stringify({ origem: 'task-a', kind: 'update' }));
  assert.deepEqual(cliente.escrito, ['data: update\n\n']);
});

test('barramento: o próprio eco é ignorado (sem entrega dupla)', () => {
  const s = criarEventStream({ log: silencioso(), origem: 'task-a' });
  const b = umBarramento();
  s.usarBarramento(b);
  const cliente = umCliente();
  s.subscribe('ev1', cliente);

  s.broadcast('ev1');
  b.receber('evento:ev1', b.publicadas[0][1]);
  assert.deepEqual(cliente.escrito, ['data: update\n\n'], 'uma entrega só');
});

test('barramento: tipo fora da lista não chega ao navegador (sem injeção no stream)', () => {
  const log = silencioso();
  const s = criarEventStream({ log, origem: 'task-b' });
  const b = umBarramento();
  s.usarBarramento(b);
  const cliente = umCliente();
  s.subscribe('ev1', cliente);

  b.receber('evento:ev1', JSON.stringify({ origem: 'x', kind: 'update\n\nevent: admin\ndata: pwned' }));
  b.receber('evento:ev1', JSON.stringify({ origem: 'x', kind: 'qualquer' }));
  b.receber('evento:ev1', 'não é json');
  b.receber('outro:ev1', JSON.stringify({ origem: 'x', kind: 'update' }));
  assert.deepEqual(cliente.escrito, []);
  assert.equal(log.avisos.length, 3);
});

test('barramento: broadcast com tipo desconhecido é erro de programação', () => {
  const s = criarEventStream({ log: silencioso() });
  assert.throws(() => s.broadcast('ev1', 'atualizou'), /tipo de broadcast desconhecido/);
});

test('barramento: ligado depois, assina os eventos que já tinham alguém olhando', () => {
  const s = criarEventStream({ log: silencioso() });
  s.subscribe('ev1', umCliente());
  s.subscribe('ev7', umCliente());

  const b = umBarramento();
  s.usarBarramento(b);
  assert.deepEqual(b.assinaturas.sort(), ['evento:ev1', 'evento:ev7']);
});

test('barramento: sem barramento, comportamento local de sempre', () => {
  const s = criarEventStream({ log: silencioso() });
  const cliente = umCliente();
  s.subscribe('ev1', cliente);
  s.broadcast('ev1');
  assert.deepEqual(cliente.escrito, ['data: update\n\n']);
});

test('barramento: cada instância tem origem própria', () => {
  assert.notEqual(criarEventStream().origem, criarEventStream().origem);
});
