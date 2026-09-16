const test = require('node:test');
const assert = require('node:assert');
const {
  podeOrganizar,
  ehAdmin,
  podePedirParaOrganizar,
  impedimentoParaTrocarPapel,
  impedimentoParaDecidir,
} = require('../src/lib/roles');

// --- Hierarquia ---

test('papéis: admin organiza também', () => {
  assert.equal(podeOrganizar('organizer'), true);
  // O dono da plataforma ser a única pessoa impedida de criar um evento nela
  // seria o efeito colateral de promover a própria conta.
  assert.equal(podeOrganizar('admin'), true);
  assert.equal(podeOrganizar('player'), false);
  assert.equal(podeOrganizar(undefined), false);
});

test('papéis: organizador não é admin', () => {
  assert.equal(ehAdmin('admin'), true);
  assert.equal(ehAdmin('organizer'), false);
  assert.equal(ehAdmin('player'), false);
  assert.equal(ehAdmin(undefined), false);
});

test('papéis: só player tem o que pedir', () => {
  assert.equal(podePedirParaOrganizar('player'), true);
  assert.equal(podePedirParaOrganizar('organizer'), false);
  assert.equal(podePedirParaOrganizar('admin'), false);
});

// --- Troca de papel ---

test('troca de papel: ninguém mexe no próprio', () => {
  // Um admin que se rebaixa perde a rota que desfaria isso.
  assert.equal(
    impedimentoParaTrocarPapel({ alvoId: 'u1', alvoPapel: 'admin', autorId: 'u1', novoPapel: 'player' }),
    'api.cannotChangeOwnRole'
  );
});

test('troca de papel: promover e rebaixar outra conta é permitido', () => {
  assert.equal(
    impedimentoParaTrocarPapel({ alvoId: 'u2', alvoPapel: 'organizer', autorId: 'u1', novoPapel: 'player' }),
    null
  );
  assert.equal(
    impedimentoParaTrocarPapel({ alvoId: 'u2', alvoPapel: 'organizer', autorId: 'u1', novoPapel: 'admin' }),
    null
  );
});

test('troca de papel: papel inexistente não passa', () => {
  assert.equal(
    impedimentoParaTrocarPapel({ alvoId: 'u2', alvoPapel: 'player', autorId: 'u1', novoPapel: 'superuser' }),
    'api.invalidRole'
  );
});

test('troca de papel: trocar pelo mesmo papel é recusado', () => {
  // Não é inofensivo: passaria por promoção na tela e geraria um aviso dizendo
  // à pessoa que algo mudou quando nada mudou.
  assert.equal(
    impedimentoParaTrocarPapel({ alvoId: 'u2', alvoPapel: 'organizer', autorId: 'u1', novoPapel: 'organizer' }),
    'api.roleUnchanged'
  );
});

// --- Decisão do pedido ---

test('decisão: pedido pendente pode ser decidido', () => {
  assert.equal(impedimentoParaDecidir({ status: 'pending' }), null);
});

test('decisão: pedido já decidido não volta para a fila', () => {
  // Duas abas abertas na mesma fila não podem virar uma aprovação em cima de
  // uma recusa já dada.
  assert.equal(impedimentoParaDecidir({ status: 'approved' }), 'api.requestAlreadyDecided');
  assert.equal(impedimentoParaDecidir({ status: 'rejected' }), 'api.requestAlreadyDecided');
});

test('decisão: pedido inexistente é 404, não conflito', () => {
  assert.equal(impedimentoParaDecidir(null), 'api.requestNotFound');
  assert.equal(impedimentoParaDecidir(undefined), 'api.requestNotFound');
});
