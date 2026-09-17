const test = require('node:test');
const assert = require('node:assert');
const { ambiente, CONTEXTO_PRONTO, CONTEXTO_LOCAL_PRONTO, CONTA_TESTE } = require('./ajuda');

function regras({ migrarFalha = false, semBootstrap = false, testesFalham = false } = {}) {
  return [
    { ferramenta: 'npm', padrao: '^test$', codigo: testesFalham ? 1 : 0 },
    { ferramenta: 'aws', padrao: '^cloudformation describe-stacks --stack-name CDKToolkit', stdout: 'UPDATE_COMPLETE\n', codigo: semBootstrap ? 254 : 0 },
    { ferramenta: 'cdk', padrao: '^deploy' },
    { ferramenta: 'migrar', padrao: '.*', codigo: migrarFalha ? 1 : 0 },
    { ferramenta: 'publicar', padrao: '.*' },
  ];
}

/** A sequência de passos, como texto curto: "deploy Rede Dados Migracao", "migrar --sem-snapshot"... */
const passos = (amb) =>
  amb
    .chamadas()
    .filter((c) => ['cdk', 'migrar', 'publicar'].includes(c.ferramenta) || (c.ferramenta === 'npm' && c.linha === 'test'))
    .map((c) => {
      if (c.ferramenta === 'cdk') return 'deploy ' + c.args.filter((a) => a.startsWith('ManaSync')).map((a) => a.replace('ManaSync', '')).join(' ');
      if (c.ferramenta === 'npm') return 'testes';
      return `${c.ferramenta} ${c.linha}`.trim();
    });

test('deploy primeiro: a migração roda entre dados e aplicação, sem snapshot', (t) => {
  const amb = ambiente(t, { regras: regras() });
  const r = amb.rodar('deploy.sh', ['primeiro']);
  assert.equal(r.codigo, 0, r.erro + amb.resumo());
  assert.deepEqual(passos(amb), [
    'testes',
    'deploy Rede Dados Migracao',
    'migrar --sem-snapshot',
    'deploy Borda',
    'publicar',
    'deploy App',
  ]);
  assert.match(r.erro, /Crie a sua conta/);
});

test('deploy release: migração com snapshot antes da aplicação; SPA por último', (t) => {
  const amb = ambiente(t, { regras: regras() });
  const r = amb.rodar('deploy.sh', ['release']);
  assert.equal(r.codigo, 0, r.erro);
  assert.deepEqual(passos(amb), ['testes', 'deploy Rede Dados Migracao', 'migrar', 'deploy Borda', 'deploy App', 'publicar']);
});

test('deploy: migração que falha impede a aplicação de subir', (t) => {
  for (const modo of ['primeiro', 'release']) {
    const amb = ambiente(t, { regras: regras({ migrarFalha: true }) });
    const r = amb.rodar('deploy.sh', [modo]);
    assert.notEqual(r.codigo, 0, modo);
    assert.ok(!passos(amb).includes('deploy App'), `${modo}: ${passos(amb)}`);
    assert.ok(!passos(amb).includes('publicar'), `${modo}: ${passos(amb)}`);
  }
});

test('deploy: testes de template que falham param antes de qualquer cdk deploy', (t) => {
  const amb = ambiente(t, { regras: regras({ testesFalham: true }) });
  assert.notEqual(amb.rodar('deploy.sh', ['release']).codigo, 0);
  assert.equal(amb.indice('cdk', '^deploy'), -1);
});

test('deploy: cada cdk deploy é --exclusively e leva o e-mail do dono', (t) => {
  const amb = ambiente(t, { regras: regras() });
  amb.rodar('deploy.sh', ['release']);
  for (const c of amb.chamadas().filter((x) => x.ferramenta === 'cdk')) {
    assert.ok(c.args.includes('--exclusively'), c.linha);
    assert.ok(c.args.includes('manasync:adminEmail=dono@exemplo.com'), c.linha);
  }
});

test('deploy: --sim não pede aprovação; sem --sim, o CDK pergunta', (t) => {
  const comSim = ambiente(t, { regras: regras() });
  comSim.rodar('deploy.sh', ['release', '--sim']);
  assert.match(comSim.chamadas().find((c) => c.ferramenta === 'cdk').linha, /--require-approval never/);

  const semSim = ambiente(t, { regras: regras(), env: { MANASYNC_SIM: '0' } });
  semSim.rodar('deploy.sh', ['release']);
  assert.doesNotMatch(semSim.chamadas().find((c) => c.ferramenta === 'cdk').linha, /--require-approval/);
});

test('deploy: zona, ID da zona ou certificado ainda TROCAR param antes de tudo', (t) => {
  for (const chave of ['manasync:zoneName', 'manasync:hostedZoneId', 'manasync:certificateArn']) {
    const amb = ambiente(t, { regras: regras(), contexto: { ...CONTEXTO_PRONTO, [chave]: 'TROCAR_depois' } });
    const r = amb.rodar('deploy.sh', ['primeiro']);
    assert.notEqual(r.codigo, 0);
    assert.match(r.erro, new RegExp(chave));
    assert.equal(amb.indice('cdk', '.*'), -1);
  }
});

test('deploy: ARN do certificado vem do cdk.context.json; sem ele em nenhum dos dois arquivos, para', (t) => {
  const comLocal = ambiente(t, { regras: regras() });
  assert.equal(comLocal.rodar('deploy.sh', ['release', '--pular-testes']).codigo, 0);
  assert.ok(!JSON.stringify(CONTEXTO_PRONTO).includes(CONTA_TESTE), 'o cdk.json de teste imita o versionado: sem conta');
  assert.ok(CONTEXTO_LOCAL_PRONTO['manasync:certificateArn']);

  const semLocal = ambiente(t, { regras: regras(), contextoLocal: null });
  const r = semLocal.rodar('deploy.sh', ['release', '--pular-testes']);
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /manasync:certificateArn/);
  assert.equal(semLocal.indice('cdk', '.*'), -1);
});

test('deploy: sem bootstrap do CDK, orienta e para', (t) => {
  const amb = ambiente(t, { regras: regras({ semBootstrap: true }) });
  const r = amb.rodar('deploy.sh', ['primeiro', '--pular-testes']);
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /cdk bootstrap aws:\/\/\$MANASYNC_CONTA\/us-east-2/);
  assert.equal(amb.indice('cdk', '.*'), -1);
});

test('deploy: modo inválido ou ausente mostra o uso e não toca em nada', (t) => {
  for (const args of [[], ['tudo']]) {
    const amb = ambiente(t, { regras: regras() });
    const r = amb.rodar('deploy.sh', args);
    assert.notEqual(r.codigo, 0);
    assert.match(r.erro, /uso: scripts\/deploy\.sh primeiro\|release/);
    assert.deepEqual(amb.chamadas(), []);
  }
});

test('deploy: --pular-testes pula só os testes', (t) => {
  const amb = ambiente(t, { regras: regras() });
  assert.equal(amb.rodar('deploy.sh', ['release', '--pular-testes']).codigo, 0);
  assert.ok(!passos(amb).includes('testes'));
  assert.ok(passos(amb).includes('deploy App'));
});
