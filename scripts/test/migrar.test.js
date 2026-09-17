const test = require('node:test');
const assert = require('node:assert');
const { ambiente, saida } = require('./ajuda');

const TASK = 'arn:aws:ecs:us-east-2:111122223333:task/manasync/abc123';

const SAIDAS = [
  saida('ManaSyncDados', 'BancoInstancia', 'manasyncdados-mysql'),
  saida('ManaSyncMigracao', 'TaskDefArn', 'arn:aws:ecs:us-east-2:111122223333:task-definition/migracao:3'),
  saida('ManaSyncMigracao', 'ClusterArn', 'arn:aws:ecs:us-east-2:111122223333:cluster/manasync'),
  saida('ManaSyncMigracao', 'SgMigracao', 'sg-0migracao'),
  saida('ManaSyncMigracao', 'SubnetsPublicas', 'subnet-a,subnet-b'),
  saida('ManaSyncMigracao', 'LogGroup', 'ManaSyncMigracao-Logs'),
];

/** Uma migração que dá certo, do snapshot ao fim. */
function regras({ codigo = '0', semTask = false, snapshotFalha = false, snapshots = [] } = {}) {
  return [
    ...SAIDAS,
    { ferramenta: 'aws', padrao: '^rds create-db-snapshot', stdout: '{}' },
    { ferramenta: 'aws', padrao: '^rds wait db-snapshot-available', codigo: snapshotFalha ? 255 : 0 },
    {
      ferramenta: 'aws',
      padrao: '^ecs run-task',
      stdout: JSON.stringify(semTask ? { tasks: [], failures: [{ reason: 'RESOURCE:ENI' }] } : { tasks: [{ taskArn: TASK }], failures: [] }),
    },
    { ferramenta: 'aws', padrao: '^ecs wait tasks-stopped' },
    { ferramenta: 'aws', padrao: '^ecs describe-tasks', stdout: `${codigo}\tEssential container in task exited\n` },
    { ferramenta: 'aws', padrao: '^logs get-log-events', stdout: '[migrate] {"acao":"migrar","aplicadas":[]}\n' },
    { ferramenta: 'aws', padrao: '^rds describe-db-snapshots', stdout: JSON.stringify({ DBSnapshots: snapshots }) },
    { ferramenta: 'aws', padrao: '^rds delete-db-snapshot', stdout: '{}' },
  ];
}

test('migrar: snapshot fica pronto ANTES de a task rodar', (t) => {
  const amb = ambiente(t, { regras: regras() });
  const r = amb.rodar('migrar.sh');
  assert.equal(r.codigo, 0, r.erro + amb.resumo());

  const criar = amb.indice('aws', '^rds create-db-snapshot --db-instance-identifier manasyncdados-mysql --db-snapshot-identifier manasync-pre-migracao-');
  const esperar = amb.indice('aws', '^rds wait db-snapshot-available');
  const rodar = amb.indice('aws', '^ecs run-task');
  assert.ok(criar >= 0 && criar < esperar && esperar < rodar, amb.resumo());
});

test('migrar: task na rede certa — subnets públicas, SG da migração, IP público', (t) => {
  const amb = ambiente(t, { regras: regras() });
  amb.rodar('migrar.sh');
  const chamada = amb.chamadas().find((c) => c.linha.startsWith('ecs run-task'));
  assert.match(chamada.linha, /--launch-type FARGATE/);
  assert.match(chamada.linha, /awsvpcConfiguration=\{subnets=\[subnet-a,subnet-b\],securityGroups=\[sg-0migracao\],assignPublicIp=ENABLED\}/);
  assert.match(chamada.linha, /--task-definition arn:aws:ecs:.*task-definition\/migracao:3/);
});

test('migrar: --sem-snapshot não cria snapshot', (t) => {
  const amb = ambiente(t, { regras: regras() });
  const r = amb.rodar('migrar.sh', ['--sem-snapshot']);
  assert.equal(r.codigo, 0, r.erro);
  assert.equal(amb.indice('aws', '^rds create-db-snapshot'), -1);
  assert.match(r.erro, /sem snapshot/);
});

test('migrar: migração com erro para com código ≠ 0, mostra o log e aponta o snapshot', (t) => {
  const amb = ambiente(t, { regras: regras({ codigo: '1' }) });
  const r = amb.rodar('migrar.sh');
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /migração falhou \(exitCode=1/);
  assert.match(r.erro, /\[migrate\]/, 'o log da task aparece');
  assert.match(r.erro, /snapshot para restaurar, se preciso: manasync-pre-migracao-/);
  assert.equal(amb.indice('aws', '^rds delete-db-snapshot'), -1, 'nada é limpo depois de uma falha');
});

test('migrar: container que nem iniciou (exitCode None) também é falha', (t) => {
  const amb = ambiente(t, { regras: regras({ codigo: 'None' }) });
  assert.notEqual(amb.rodar('migrar.sh').codigo, 0);
});

test('migrar: task que não inicia aborta com o motivo', (t) => {
  const amb = ambiente(t, { regras: regras({ semTask: true }) });
  const r = amb.rodar('migrar.sh');
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /a task não iniciou.*RESOURCE:ENI/);
});

test('migrar: snapshot que não fica disponível impede a migração', (t) => {
  const amb = ambiente(t, { regras: regras({ snapshotFalha: true }) });
  const r = amb.rodar('migrar.sh');
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /migração NÃO executada/);
  assert.equal(amb.indice('aws', '^ecs run-task'), -1);
});

test('migrar: os 3 mais recentes ficam mesmo se antigos; recentes ficam', (t) => {
  const dias = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const snapshots = ['x', 'y', 'z'].map((s, i) => ({ DBSnapshotIdentifier: `manasync-pre-migracao-${s}`, SnapshotCreateTime: dias(100 + i) }));
  const amb = ambiente(t, { regras: regras({ snapshots }) });
  assert.equal(amb.rodar('migrar.sh').codigo, 0);
  assert.equal(amb.indice('aws', '^rds delete-db-snapshot'), -1, 'com só 3 snapshots, nenhum sai');
});

test('migrar: limpa só snapshots próprios, antigos e além dos 3 mais recentes', (t) => {
  const dias = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const snap = (id, idade) => ({ DBSnapshotIdentifier: id, SnapshotCreateTime: dias(idade) });
  const snapshots = [
    // Do mais novo ao mais velho: a (1d), e (10d), b (40d) | c (50d), d (60d).
    snap('manasync-pre-migracao-a', 1), // 1º mais recente: fica
    snap('manasync-pre-migracao-b', 40), // 3º mais recente: fica mesmo passando de 30 dias
    snap('manasync-pre-migracao-c', 50), // 4º, antigo: sai
    snap('manasync-pre-migracao-d', 60), // 5º, antigo: sai
    snap('manasync-pre-migracao-e', 10), // 2º mais recente: fica
    snap('snapshot-manual-do-dono', 90), // outro prefixo: nunca é tocado
  ];
  const amb = ambiente(t, { regras: regras({ snapshots }) });
  const r = amb.rodar('migrar.sh');
  assert.equal(r.codigo, 0, r.erro);
  const apagados = amb.chamadas().filter((c) => c.linha.startsWith('rds delete-db-snapshot')).map((c) => c.args.at(-1));
  assert.deepEqual(apagados.sort(), ['manasync-pre-migracao-c', 'manasync-pre-migracao-d']);
});

test('migrar: argumento desconhecido não roda nada', (t) => {
  const amb = ambiente(t, { regras: regras() });
  const r = amb.rodar('migrar.sh', ['--sem-snapshto']);
  assert.notEqual(r.codigo, 0);
  assert.deepEqual(amb.chamadas(), []);
});
