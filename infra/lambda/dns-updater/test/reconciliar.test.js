const test = require('node:test');
const assert = require('node:assert');
const { processarEvento, reconciliar, lerConfig } = require('../src/reconciliar');

const REGISTRO = 'origin.app.mercadiastore.online';
const CONFIG = {
  cluster: 'arn:aws:ecs:us-east-2:111122223333:cluster/manasync',
  servico: 'manasync-backend',
  zona: 'Z123',
  registro: REGISTRO,
  ttl: 30,
  esperaSaudeMs: 20000,
};

/**
 * Uma "AWS" em memória, com estado que o teste pode mudar a qualquer momento.
 * Implementa o mesmo contrato do adaptador real (src/aws.js), incluindo a
 * recusa do Route 53 quando o DELETE não bate com o registro atual.
 */
function umaAws() {
  const a = {
    tasks: new Map(), // arn -> { lastStatus, desiredStatus, healthStatus, eni }
    ips: new Map(), // eni -> ip
    registro: null, // { ttl, valores }
    escritas: [],
    antesDeTrocar: null, // gancho: simula outra execução mexendo no registro
  };

  a.task = (arn, { ip, saude = 'HEALTHY', last = 'RUNNING', desired = 'RUNNING' }) => {
    const eni = `eni-${arn}`;
    a.tasks.set(arn, { taskArn: arn, lastStatus: last, desiredStatus: desired, healthStatus: saude, eni });
    a.ips.set(eni, ip);
  };

  a.listarTasks = async () => [...a.tasks.values()].filter((t) => t.desiredStatus === 'RUNNING').map((t) => t.taskArn);
  a.descreverTasks = async (_, arns) =>
    arns
      .map((arn) => a.tasks.get(arn))
      .filter(Boolean)
      .map((t) => ({
        ...t,
        attachments: [{ type: 'ElasticNetworkInterface', details: [{ name: 'networkInterfaceId', value: t.eni }] }],
      }));
  a.ipsPublicos = async (enis) => enis.map((e) => a.ips.get(e)).filter(Boolean);
  a.lerRegistro = async (zona, nome) => {
    assert.equal(zona, 'Z123');
    assert.equal(nome, REGISTRO);
    return a.registro && { ttl: a.registro.ttl, valores: [...a.registro.valores].sort() };
  };
  a.trocarRegistro = async (_, __, { anterior, valores, ttl }) => {
    if (a.antesDeTrocar) {
      const gancho = a.antesDeTrocar;
      a.antesDeTrocar = null;
      await gancho();
    }
    const atual = a.registro && { ttl: a.registro.ttl, valores: [...a.registro.valores].sort() };
    if (JSON.stringify(atual) !== JSON.stringify(anterior ?? null)) {
      throw Object.assign(new Error('Tried to delete resource record set but it was not found'), { name: 'InvalidChangeBatch' });
    }
    a.registro = { ttl, valores: [...valores] };
    a.escritas.push([...valores]);
  };
  return a;
}

const umLog = () => {
  const l = { linhas: [], avisos: [] };
  l.log = (m) => l.linhas.push(JSON.parse(m));
  l.warn = (m) => l.avisos.push(JSON.parse(m));
  return l;
};

/** Contexto com relógio falso: `esperar` avança o tempo na hora. */
function umCtx(aws, extra = {}) {
  const relogio = { agora: 0, esperas: [] };
  return {
    aws,
    config: { ...CONFIG, ...extra.config },
    log: umLog(),
    agora: () => relogio.agora,
    esperar: async (ms) => {
      relogio.esperas.push(ms);
      relogio.agora += ms;
      if (extra.aoEsperar) extra.aoEsperar(relogio);
    },
    relogio,
  };
}

const eventoTask = (arn, last, desired) => ({
  source: 'aws.ecs',
  'detail-type': 'ECS Task State Change',
  detail: { taskArn: arn, lastStatus: last, desiredStatus: desired },
});
const agendado = { source: 'aws.events', 'detail-type': 'Scheduled Event', detail: {} };

// --- reconciliação ---

test('dns: registro inexistente recebe os IPs de todas as tasks saudáveis, ordenados', async () => {
  const aws = umaAws();
  aws.task('t2', { ip: '3.3.3.3' });
  aws.task('t1', { ip: '1.1.1.1' });
  const r = await reconciliar(umCtx(aws));
  assert.equal(r.acao, 'atualizado');
  assert.deepEqual(aws.registro, { ttl: 30, valores: ['1.1.1.1', '3.3.3.3'] });
});

test('dns: conjunto igual não gera escrita (nem chamada ao Route 53)', async () => {
  const aws = umaAws();
  aws.task('t1', { ip: '1.1.1.1' });
  aws.registro = { ttl: 30, valores: ['1.1.1.1'] };
  const r = await reconciliar(umCtx(aws));
  assert.equal(r.acao, 'sem-mudanca');
  assert.deepEqual(aws.escritas, []);
});

test('dns: mesmo IP com TTL diferente é reescrito', async () => {
  const aws = umaAws();
  aws.task('t1', { ip: '1.1.1.1' });
  aws.registro = { ttl: 60, valores: ['1.1.1.1'] };
  assert.equal((await reconciliar(umCtx(aws))).acao, 'atualizado');
  assert.equal(aws.registro.ttl, 30);
});

test('dns: fica de fora a task ainda não saudável e a que está sendo parada', async () => {
  const aws = umaAws();
  aws.task('saudavel', { ip: '1.1.1.1' });
  aws.task('subindo', { ip: '2.2.2.2', saude: 'UNKNOWN' });
  aws.task('doente', { ip: '3.3.3.3', saude: 'UNHEALTHY' });
  // O ECS decidiu parar: ainda RUNNING e saudável, mas já não pode receber tráfego novo.
  aws.task('parando', { ip: '4.4.4.4', desired: 'STOPPED' });
  const tasks = aws.tasks;
  aws.listarTasks = async () => [...tasks.keys()]; // mesmo que a listagem traga a que está parando
  await reconciliar(umCtx(aws));
  assert.deepEqual(aws.registro.valores, ['1.1.1.1']);
});

test('dns: nenhuma task saudável mantém o registro como está, com aviso', async () => {
  const aws = umaAws();
  aws.task('subindo', { ip: '2.2.2.2', saude: 'UNKNOWN' });
  aws.registro = { ttl: 30, valores: ['9.9.9.9'] };
  const ctx = umCtx(aws);
  const r = await reconciliar(ctx);
  assert.equal(r.acao, 'mantido-sem-tasks');
  assert.deepEqual(aws.registro.valores, ['9.9.9.9']);
  assert.deepEqual(aws.escritas, []);
  assert.equal(ctx.log.avisos[0].dns, 'nenhuma-task-saudavel');
});

test('dns: valor que não é IPv4 nunca entra no registro', async () => {
  const aws = umaAws();
  aws.task('t1', { ip: '1.1.1.1' });
  aws.task('t2', { ip: '999.1.1.1' });
  aws.task('t3', { ip: 'evil.example.com' });
  await reconciliar(umCtx(aws));
  assert.deepEqual(aws.registro.valores, ['1.1.1.1']);
});

// --- concorrência ---

test('dns: outra execução mudou o registro no meio — recusa, relê e grava o estado certo', async () => {
  const aws = umaAws();
  aws.task('velha', { ip: '1.1.1.1' });
  aws.registro = { ttl: 30, valores: ['1.1.1.1'] };
  aws.task('nova', { ip: '2.2.2.2' });

  // Entre a leitura e a escrita desta execução, a velha começa a parar e outra
  // execução, mais rápida, já grava só a nova.
  aws.antesDeTrocar = async () => {
    aws.tasks.get('velha').desiredStatus = 'STOPPED';
    aws.registro = { ttl: 30, valores: ['2.2.2.2'] };
  };
  const ctx = umCtx(aws);
  const r = await reconciliar(ctx);

  // Sem o controle de concorrência, esta execução gravaria [1.1.1.1, 2.2.2.2]
  // por cima — devolvendo ao DNS uma task que está parando.
  assert.deepEqual(aws.registro.valores, ['2.2.2.2']);
  assert.equal(r.acao, 'sem-mudanca');
  assert.ok(ctx.log.linhas.some((l) => l.dns === 'concorrencia'));
});

test('dns: três recusas seguidas viram erro (a próxima invocação tenta de novo)', async () => {
  const aws = umaAws();
  aws.task('t1', { ip: '1.1.1.1' });
  aws.trocarRegistro = async () => {
    throw Object.assign(new Error('not found'), { name: 'InvalidChangeBatch' });
  };
  await assert.rejects(reconciliar(umCtx(aws)), /not found/);
});

test('dns: erro que não é de concorrência não é repetido', async () => {
  const aws = umaAws();
  aws.task('t1', { ip: '1.1.1.1' });
  let chamadas = 0;
  aws.trocarRegistro = async () => {
    chamadas++;
    throw Object.assign(new Error('Rate exceeded'), { name: 'Throttling' });
  };
  await assert.rejects(reconciliar(umCtx(aws)), /Rate exceeded/);
  assert.equal(chamadas, 1);
});

// --- eventos e espera de saúde ---

test('evento RUNNING: espera a task ficar saudável e já a publica', async () => {
  const aws = umaAws();
  aws.task('velha', { ip: '1.1.1.1' });
  aws.registro = { ttl: 30, valores: ['1.1.1.1'] };
  aws.task('nova', { ip: '2.2.2.2', saude: 'UNKNOWN' });
  const ctx = umCtx(aws, {
    aoEsperar: (relogio) => {
      if (relogio.agora >= 10000) aws.tasks.get('nova').healthStatus = 'HEALTHY';
    },
  });

  const r = await processarEvento(eventoTask('nova', 'RUNNING', 'RUNNING'), ctx);
  assert.deepEqual(ctx.relogio.esperas, [5000, 5000]);
  assert.deepEqual(r.ips, ['1.1.1.1', '2.2.2.2'], 'as duas coexistem antes de a velha parar');
  assert.equal(ctx.log.linhas.at(-1).espera, 'saudavel');
});

test('evento RUNNING: prazo esgotado não publica a task doente, e não passa do limite', async () => {
  const aws = umaAws();
  aws.task('velha', { ip: '1.1.1.1' });
  aws.task('nova', { ip: '2.2.2.2', saude: 'UNKNOWN' });
  const ctx = umCtx(aws);

  const r = await processarEvento(eventoTask('nova', 'RUNNING', 'RUNNING'), ctx);
  assert.ok(ctx.relogio.agora <= CONFIG.esperaSaudeMs, `esperou ${ctx.relogio.agora}ms`);
  assert.deepEqual(r.ips, ['1.1.1.1']);
  assert.equal(ctx.log.linhas.at(-1).espera, 'prazo');
});

test('evento agendado e evento de parada não esperam nada', async () => {
  const aws = umaAws();
  aws.task('t1', { ip: '1.1.1.1' });
  for (const evento of [agendado, eventoTask('t9', 'RUNNING', 'STOPPED'), eventoTask('t9', 'STOPPED', 'STOPPED')]) {
    const ctx = umCtx(aws);
    await processarEvento(evento, ctx);
    assert.deepEqual(ctx.relogio.esperas, []);
  }
});

test('deploy completo, passo a passo: o DNS nunca fica sem task saudável', async () => {
  const aws = umaAws();
  const passo = async (evento) => (await processarEvento(evento, umCtx(aws, { config: { esperaSaudeMs: 0 } }))).ips;

  aws.task('velha', { ip: '1.1.1.1' });
  assert.deepEqual(await passo(agendado), ['1.1.1.1'], '1. estado inicial');

  aws.task('nova', { ip: '2.2.2.2', saude: 'UNKNOWN' });
  assert.deepEqual(await passo(eventoTask('nova', 'RUNNING', 'RUNNING')), ['1.1.1.1'], '2. nova subiu, ainda sem saúde');

  aws.tasks.get('nova').healthStatus = 'HEALTHY';
  assert.deepEqual(await passo(agendado), ['1.1.1.1', '2.2.2.2'], '3. nova saudável: as duas');

  aws.tasks.get('velha').desiredStatus = 'STOPPED';
  assert.deepEqual(await passo(eventoTask('velha', 'RUNNING', 'STOPPED')), ['2.2.2.2'], '4. ECS mandou parar a velha: sai do DNS');

  aws.tasks.delete('velha');
  assert.deepEqual(await passo(eventoTask('velha', 'STOPPED', 'STOPPED')), ['2.2.2.2'], '5. velha parou');
  assert.deepEqual(aws.escritas, [['1.1.1.1'], ['1.1.1.1', '2.2.2.2'], ['2.2.2.2']]);
});

// --- configuração ---

test('config: obrigatórias e padrões', () => {
  const env = { CLUSTER_ARN: 'c', SERVICE_NAME: 's', HOSTED_ZONE_ID: 'Z', RECORD_NAME: 'Origin.App.Exemplo.com.' };
  assert.deepEqual(lerConfig(env), {
    cluster: 'c',
    servico: 's',
    zona: 'Z',
    registro: 'origin.app.exemplo.com',
    ttl: 30,
    esperaSaudeMs: 20000,
  });
  for (const chave of Object.keys(env)) {
    assert.throws(() => lerConfig({ ...env, [chave]: '' }), new RegExp(chave));
  }
});

test('config: espera que não cabe no timeout da Lambda é recusada', () => {
  const env = { CLUSTER_ARN: 'c', SERVICE_NAME: 's', HOSTED_ZONE_ID: 'Z', RECORD_NAME: 'r' };
  assert.throws(() => lerConfig({ ...env, ESPERA_SAUDE_MS: '30000' }), /ESPERA_SAUDE_MS/);
  assert.throws(() => lerConfig({ ...env, TTL: '5' }), /TTL/);
});
