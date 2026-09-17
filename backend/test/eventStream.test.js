const test = require('node:test');
const assert = require('node:assert');
const { subscribe, unsubscribe, broadcast, closeAll } = require('../src/services/eventStream');

/** Um `res` de mentira: guarda o que foi escrito e se foi encerrado. */
const umCliente = () => {
  const c = { escrito: [], encerrado: false };
  c.write = (t) => c.escrito.push(t);
  c.end = () => { c.encerrado = true; };
  return c;
};

test('stream: quem assina um evento recebe só o dele', () => {
  const a = umCliente();
  const b = umCliente();
  subscribe('ev1', a);
  subscribe('ev2', b);

  broadcast('ev1');

  assert.deepEqual(a.escrito, ['data: update\n\n']);
  assert.deepEqual(b.escrito, []);
  closeAll();
});

test('stream: closeAll encerra todos e devolve quantos eram', () => {
  const a = umCliente();
  const b = umCliente();
  subscribe('ev1', a);
  subscribe('ev1', b);
  subscribe('ev2', umCliente());

  assert.equal(closeAll(), 3);
  assert.equal(a.encerrado, true);
  assert.equal(b.encerrado, true);
});

test('stream: depois do closeAll o registro fica vazio', () => {
  // Importa porque um broadcast atrasado, entre o desligamento e a saída do
  // processo, escreveria num socket já fechado.
  const a = umCliente();
  subscribe('ev1', a);
  closeAll();

  broadcast('ev1');
  assert.deepEqual(a.escrito, [], 'ninguém mais está inscrito');
});

test('stream: cliente que morre ao ser encerrado não derruba os outros', () => {
  // Socket já quebrado do outro lado: `end()` lança, e o desligamento não pode
  // parar no meio por causa disso.
  const ruim = umCliente();
  ruim.end = () => { throw new Error('socket hung up'); };
  const bom = umCliente();
  subscribe('ev1', ruim);
  subscribe('ev1', bom);

  assert.equal(closeAll(), 2);
  assert.equal(bom.encerrado, true);
});

test('stream: desinscrever limpa o evento quando esvazia', () => {
  const a = umCliente();
  subscribe('ev1', a);
  unsubscribe('ev1', a);

  broadcast('ev1');
  assert.deepEqual(a.escrito, []);
  assert.equal(closeAll(), 0, 'nada ficou pendurado no registro');
});
