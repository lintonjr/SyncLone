const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { ValkeyStore } = require('../src/lib/rateLimitStore');

/**
 * Um Valkey de mentira com a semântica dos comandos que o store usa, incluindo
 * o `NX` do PEXPIRE e a expiração por tempo controlável.
 */
function umValkey() {
  const v = { dados: new Map(), agora: 0, comandos: [] };
  const vivo = (k) => {
    const e = v.dados.get(k);
    if (e && e.expiraEm !== null && e.expiraEm <= v.agora) v.dados.delete(k);
    return v.dados.get(k);
  };
  const incr = (k, delta) => {
    const e = vivo(k) ?? { valor: 0, expiraEm: null };
    e.valor += delta;
    v.dados.set(k, e);
    return e.valor;
  };
  const pexpireNx = (k, ms) => {
    const e = vivo(k);
    if (!e || e.expiraEm !== null) return 0;
    e.expiraEm = v.agora + ms;
    return 1;
  };
  const pttl = (k) => {
    const e = vivo(k);
    if (!e) return -2;
    return e.expiraEm === null ? -1 : e.expiraEm - v.agora;
  };

  v.multi = () => {
    const fila = [];
    const t = {
      incr: (k) => { fila.push(() => incr(k, 1)); return t; },
      pexpire: (k, ms, modo) => {
        assert.equal(modo, 'NX', 'o store precisa usar NX');
        fila.push(() => pexpireNx(k, ms));
        return t;
      },
      pttl: (k) => { fila.push(() => pttl(k)); return t; },
      exec: async () => fila.map((f) => [null, f()]),
    };
    return t;
  };
  v.decr = async (k) => { v.comandos.push(['decr', k]); return incr(k, -1); };
  v.del = async (k) => { v.comandos.push(['del', k]); return v.dados.delete(k) ? 1 : 0; };
  return v;
}

const JANELA = 15 * 60 * 1000;

function umStore(valkey = umValkey()) {
  const store = new ValkeyStore({ cliente: valkey });
  store.init({ windowMs: JANELA });
  return { store, valkey };
}

test('store: conta tentativas e fixa a janela na primeira', async () => {
  const { store, valkey } = umStore();
  const r1 = await store.increment('1.2.3.4:a@x.com');
  assert.equal(r1.totalHits, 1);

  valkey.agora = 60000;
  const r2 = await store.increment('1.2.3.4:a@x.com');
  assert.equal(r2.totalHits, 2);
  // O NX não renovou: restam 14 min, não 15.
  const [chave] = [...valkey.dados.keys()];
  assert.equal(valkey.dados.get(chave).expiraEm, JANELA);
});

test('store: a janela expira e a contagem recomeça', async () => {
  const { store, valkey } = umStore();
  for (let i = 0; i < 5; i++) await store.increment('k');
  valkey.agora = JANELA + 1;
  assert.equal((await store.increment('k')).totalHits, 1);
});

test('store: a chave guardada é um resumo — sem IP nem e-mail legíveis', async () => {
  const { store, valkey } = umStore();
  await store.increment('203.0.113.9:alguem@exemplo.com');
  const [chave] = [...valkey.dados.keys()];
  assert.match(chave, /^rl:[0-9a-f]{64}$/);
  assert.doesNotMatch(chave, /203|alguem|exemplo/);
});

test('store: decrement devolve uma tentativa', async () => {
  const { store } = umStore();
  await store.increment('k');
  await store.increment('k');
  await store.decrement('k');
  assert.equal((await store.increment('k')).totalHits, 2);
});

test('store: decrement de chave expirada não deixa crédito eterno', async () => {
  const { store, valkey } = umStore();
  await store.increment('k');
  valkey.agora = JANELA + 1; // expirou entre o increment e o decrement
  await store.decrement('k');
  assert.equal(valkey.dados.size, 0, 'a chave -1 sem prazo foi apagada');
  assert.equal((await store.increment('k')).totalHits, 1);
});

test('store: resetKey apaga', async () => {
  const { store, valkey } = umStore();
  await store.increment('k');
  await store.resetKey('k');
  assert.equal(valkey.dados.size, 0);
});

test('store: erro dentro da transação sobe (o limiter decide com passOnStoreError)', async () => {
  const valkey = umValkey();
  valkey.multi = () => {
    const t = { incr: () => t, pexpire: () => t, pttl: () => t, exec: async () => [[new Error('NOPERM'), null], [null, 1], [null, 1]] };
    return t;
  };
  const { store } = umStore(valkey);
  await assert.rejects(store.increment('k'), /NOPERM/);
});

test('store: marca-se como não local (contadores compartilhados)', () => {
  assert.equal(new ValkeyStore({ cliente: {} }).localKeys, false);
});

// --- com o express-rate-limit de verdade ---

/** Um app mínimo com a mesma configuração do limiter de login. */
function umApp(valkey, extra = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  const limiter = rateLimit({
    windowMs: JANELA,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    // Igual a routes/auth.js: ipKeyGenerator agrupa IPv6 por /56 — sem ele, quem
    // tem um bloco IPv6 troca de endereço a cada tentativa e nunca é limitado.
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email ?? '').toLowerCase()}`,
    store: new ValkeyStore({ cliente: valkey }),
    passOnStoreError: true,
    ...extra,
  });
  app.post('/login', limiter, (req, res) => res.status(req.body.senha === 'certa' ? 200 : 401).end());
  return app;
}

async function comServidor(app, fn) {
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise((r) => servidor.once('listening', r));
  try {
    return await fn(`http://127.0.0.1:${servidor.address().port}/login`);
  } finally {
    await new Promise((r) => servidor.close(r));
  }
}

const tentar = (url, senha, ip = '198.51.100.7') =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email: 'vitima@x.com', senha }),
  }).then((r) => r.status);

test('limiter: 10 erros passam, o 11º é 429', async () => {
  const valkey = umValkey();
  await comServidor(umApp(valkey), async (url) => {
    for (let i = 0; i < 10; i++) assert.equal(await tentar(url, 'errada'), 401);
    assert.equal(await tentar(url, 'errada'), 429);
  });
});

test('limiter: duas tasks com o mesmo Valkey somam as tentativas', async () => {
  // O cenário que o MemoryStore não cobria: o atacante alterna entre tasks.
  const valkey = umValkey();
  await comServidor(umApp(valkey), (urlA) =>
    comServidor(umApp(valkey), async (urlB) => {
      for (let i = 0; i < 10; i++) await tentar(i % 2 ? urlA : urlB, 'errada');
      assert.equal(await tentar(urlA, 'errada'), 429);
      assert.equal(await tentar(urlB, 'errada'), 429);
    })
  );
});

test('limiter: login certo não gasta tentativa', async () => {
  const valkey = umValkey();
  await comServidor(umApp(valkey), async (url) => {
    for (let i = 0; i < 20; i++) assert.equal(await tentar(url, 'certa'), 200);
    for (let i = 0; i < 10; i++) assert.equal(await tentar(url, 'errada'), 401);
  });
});

test('limiter: Valkey fora do ar deixa o login passar (passOnStoreError)', async () => {
  const quebrado = umValkey();
  quebrado.multi = () => {
    const t = { incr: () => t, pexpire: () => t, pttl: () => t, exec: async () => { throw new Error('Connection is closed.'); } };
    return t;
  };
  const erroOriginal = console.error;
  console.error = () => {}; // o express-rate-limit loga o erro do store
  try {
    await comServidor(umApp(quebrado), async (url) => {
      for (let i = 0; i < 15; i++) assert.equal(await tentar(url, 'errada'), 401);
    });
  } finally {
    console.error = erroOriginal;
  }
});
