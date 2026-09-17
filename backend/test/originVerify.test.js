const test = require('node:test');
const assert = require('node:assert');
const { criarOriginVerify, HEADER } = require('../src/middleware/originVerify');

const ATUAL = 'a'.repeat(48);
const ANTERIOR = 'b'.repeat(48);

/** Um log que não escreve no terminal, mas guarda o que ouviu. */
const umLog = () => {
  const l = { avisos: [] };
  l.warn = (m) => l.avisos.push(m);
  return l;
};

/** Passa uma requisição de mentira pelo middleware e conta o que aconteceu. */
function passar(middleware, { path = '/api/events', cabecalho } = {}) {
  const req = {
    method: 'GET',
    path,
    socket: { remoteAddress: '203.0.113.9' },
    get: (nome) => (nome.toLowerCase() === HEADER ? cabecalho : undefined),
  };
  const res = {
    statusCode: null,
    corpo: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.corpo = b; return this; },
  };
  let seguiu = false;
  middleware(req, res, () => { seguiu = true; });
  return { seguiu, res };
}

test('origem: header certo passa', () => {
  const mw = criarOriginVerify([ATUAL], { log: umLog() });
  assert.equal(passar(mw, { cabecalho: ATUAL }).seguiu, true);
});

test('origem: sem header, 403 sem explicação', () => {
  const mw = criarOriginVerify([ATUAL], { log: umLog() });
  const { seguiu, res } = passar(mw);
  assert.equal(seguiu, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.corpo, { error: 'Forbidden', code: 'api.forbidden' });
});

test('origem: header errado, e também um prefixo do certo, são recusados', () => {
  const mw = criarOriginVerify([ATUAL], { log: umLog() });
  assert.equal(passar(mw, { cabecalho: 'errado' }).res.statusCode, 403);
  // Comparação por resumo: tamanho diferente não lança erro nem passa.
  assert.equal(passar(mw, { cabecalho: ATUAL.slice(0, 10) }).res.statusCode, 403);
  assert.equal(passar(mw, { cabecalho: `${ATUAL}x` }).res.statusCode, 403);
});

test('origem: durante a rotação, atual e anterior passam', () => {
  const mw = criarOriginVerify([ATUAL, ANTERIOR], { log: umLog() });
  assert.equal(passar(mw, { cabecalho: ATUAL }).seguiu, true);
  assert.equal(passar(mw, { cabecalho: ANTERIOR }).seguiu, true);
  assert.equal(passar(mw, { cabecalho: 'c'.repeat(48) }).res.statusCode, 403);
});

test('origem: health check do container não precisa do header', () => {
  const mw = criarOriginVerify([ATUAL], { log: umLog() });
  assert.equal(passar(mw, { path: '/api/health' }).seguiu, true);
  // Só o caminho exato: nada de liberar por prefixo.
  assert.equal(passar(mw, { path: '/api/health/../events' }).res.statusCode, 403);
});

test('origem: sem segredos configurados, não interfere (Docker local)', () => {
  const mw = criarOriginVerify([], { log: umLog() });
  assert.equal(passar(mw).seguiu, true);
});

test('origem: o log registra a recusa, mas nunca o valor recebido', () => {
  const log = umLog();
  const mw = criarOriginVerify([ATUAL], { log });
  const tentativa = 'palpite-do-atacante-123';
  passar(mw, { cabecalho: tentativa });
  assert.equal(log.avisos.length, 1);
  assert.match(log.avisos[0], /203\.0\.113\.9/);
  assert.doesNotMatch(log.avisos[0], new RegExp(tentativa));
});
