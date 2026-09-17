const test = require('node:test');
const assert = require('node:assert');
const { criarDesligamento } = require('../src/lib/desligamento');
const { desligamentoConfig, TETO_DESLIGAMENTO_MS } = require('../src/lib/config');

/** Relógio controlado pelo teste: timers só disparam quando o teste avança. */
function umRelogio() {
  const r = { agora: 0, timers: [] };
  r.agendar = (fn, ms) => {
    const t = { quando: r.agora + ms, fn, unref() {} };
    r.timers.push(t);
    return t;
  };
  r.avancar = async (ms) => {
    const alvo = r.agora + ms;
    for (;;) {
      r.timers.sort((a, b) => a.quando - b.quando);
      const proximo = r.timers[0];
      if (!proximo || proximo.quando > alvo) break;
      r.timers.shift();
      r.agora = proximo.quando;
      proximo.fn();
      await new Promise(setImmediate); // deixa as promessas encadeadas andarem
    }
    r.agora = alvo;
    await new Promise(setImmediate);
  };
  return r;
}

/** Tudo que o desligamento toca, registrando a ordem das chamadas. */
function umAmbiente({ servidorTravado = false, falhaValkey = false } = {}) {
  const a = { passos: [], saidas: [], logs: [] };
  a.server = {
    close: (cb) => {
      a.passos.push('server.close');
      a.fecharServidor = () => { a.passos.push('sem-conexoes'); cb(); };
      if (!servidorTravado) setImmediate(a.fecharServidor);
    },
  };
  a.fecharStreams = () => { a.passos.push('streams'); return 2; };
  a.encerrarValkey = async () => {
    a.passos.push('valkey');
    if (falhaValkey) throw new Error('Connection is closed.');
  };
  a.encerrarBanco = async () => { a.passos.push('banco'); };
  a.sair = (codigo) => a.saidas.push(codigo);
  a.log = { log: (m) => a.logs.push(m), error: (m) => a.logs.push(m) };
  return a;
}

const montar = (amb, relogio, extra) =>
  criarDesligamento({
    server: amb.server,
    fecharStreams: amb.fecharStreams,
    encerrarValkey: amb.encerrarValkey,
    encerrarBanco: amb.encerrarBanco,
    log: amb.log,
    sair: amb.sair,
    agendar: relogio.agendar,
    ...extra,
  });

test('desligamento: SIGTERM continua atendendo durante o atraso — nada fecha antes', async () => {
  const relogio = umRelogio();
  const amb = umAmbiente();
  const desligar = montar(amb, relogio, { atrasoMs: 45000, limiteMs: 10000 });

  desligar('SIGTERM');
  await relogio.avancar(44999);
  assert.deepEqual(amb.passos, [], 'o servidor ainda precisa aceitar conexões');
  assert.deepEqual(amb.saidas, []);
  assert.match(amb.logs[0], /atendendo por mais 45000ms/);
});

test('desligamento: depois do atraso, fecha na ordem certa e sai com 0', async () => {
  const relogio = umRelogio();
  const amb = umAmbiente();
  const desligar = montar(amb, relogio, { atrasoMs: 45000, limiteMs: 10000 });

  const fim = desligar('SIGTERM');
  await relogio.avancar(45000);
  await fim;
  assert.deepEqual(amb.passos, ['server.close', 'streams', 'sem-conexoes', 'valkey', 'banco']);
  assert.deepEqual(amb.saidas, [0]);
});

test('desligamento: SIGINT (Ctrl+C) não espera o atraso', async () => {
  const relogio = umRelogio();
  const amb = umAmbiente();
  // Sem `await` no desligamento e sem avançar o relógio: se o SIGINT esperasse o
  // atraso, a promessa ficaria pendurada e o teste seria "cancelado", não
  // reprovado. Assim ele reprova.
  montar(amb, relogio, { atrasoMs: 45000 })('SIGINT');
  await relogio.avancar(0);
  await new Promise(setImmediate);
  assert.deepEqual(amb.passos, ['server.close', 'streams', 'sem-conexoes', 'valkey', 'banco']);
  assert.deepEqual(amb.saidas, [0]);
});

test('desligamento: atraso 0 (padrão local) fecha na hora', async () => {
  const relogio = umRelogio();
  const amb = umAmbiente();
  montar(amb, relogio, {})('SIGTERM');
  await relogio.avancar(0);
  await new Promise(setImmediate);
  assert.deepEqual(amb.saidas, [0]);
});

test('desligamento: segundo sinal não recomeça nada', async () => {
  const relogio = umRelogio();
  const amb = umAmbiente();
  const desligar = montar(amb, relogio, { atrasoMs: 1000 });
  const fim = desligar('SIGTERM');
  desligar('SIGTERM');
  desligar('SIGINT');
  await relogio.avancar(1000);
  await fim;
  assert.equal(amb.passos.filter((p) => p === 'server.close').length, 1);
  assert.deepEqual(amb.saidas, [0]);
});

test('desligamento: o prazo de segurança conta depois do atraso, não desde o sinal', async () => {
  const relogio = umRelogio();
  const amb = umAmbiente({ servidorTravado: true }); // uma conexão que nunca termina
  const desligar = montar(amb, relogio, { atrasoMs: 45000, limiteMs: 10000 });

  desligar('SIGTERM');
  await relogio.avancar(45000 + 9999);
  assert.deepEqual(amb.saidas, [], 'o fechamento ainda tem 1ms do seu prazo');
  await relogio.avancar(1);
  assert.deepEqual(amb.saidas, [1]);
  assert.ok(amb.logs.some((l) => /saindo à força/.test(l)));
});

test('desligamento: falha ao fechar o Valkey sai com 1, sem pular o log', async () => {
  const relogio = umRelogio();
  const amb = umAmbiente({ falhaValkey: true });
  await montar(amb, relogio, {})('SIGTERM');
  assert.deepEqual(amb.saidas, [1]);
  assert.ok(amb.logs.some((l) => /falhou: Connection is closed/.test(l)));
  assert.ok(!amb.passos.includes('banco'));
});

// --- configuração ---

test('config desligamento: padrões — sem atraso, 10s de prazo', () => {
  assert.deepEqual(desligamentoConfig({}), { atrasoMs: 0, limiteMs: 10000 });
});

test('config desligamento: valores de produção', () => {
  assert.deepEqual(desligamentoConfig({ PRE_STOP_DELAY_MS: '45000', SHUTDOWN_TIMEOUT_MS: '10000' }), {
    atrasoMs: 45000,
    limiteMs: 10000,
  });
});

test('config desligamento: lixo e negativos não viram padrão em silêncio', () => {
  assert.throws(() => desligamentoConfig({ PRE_STOP_DELAY_MS: 'meio minuto' }), /PRE_STOP_DELAY_MS/);
  assert.throws(() => desligamentoConfig({ PRE_STOP_DELAY_MS: '-1' }), /PRE_STOP_DELAY_MS/);
  assert.throws(() => desligamentoConfig({ SHUTDOWN_TIMEOUT_MS: '500' }), /SHUTDOWN_TIMEOUT_MS/);
});

test('config desligamento: soma acima do stopTimeout do Fargate não sobe', () => {
  assert.throws(
    () => desligamentoConfig({ PRE_STOP_DELAY_MS: '110000', SHUTDOWN_TIMEOUT_MS: '10000' }),
    /Fargate mata o processo aos 120s/
  );
  assert.equal(desligamentoConfig({ PRE_STOP_DELAY_MS: String(TETO_DESLIGAMENTO_MS - 10000) }).atrasoMs, TETO_DESLIGAMENTO_MS - 10000);
});
