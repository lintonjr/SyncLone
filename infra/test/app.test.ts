import { test } from 'node:test';
import assert from 'node:assert';
import { ambiente, json, montarTeste, segredos, unico } from './ajuda';

const { tpl, stacks } = montarTeste();
const app = tpl.app;
const td = unico(app, 'AWS::ECS::TaskDefinition');
const container = td.Properties.ContainerDefinitions[0];
const env = ambiente(container);
const sec = segredos(container);

test('app: a task NÃO recebe ADMIN_EMAIL nem a credencial master (N1, f)', () => {
  assert.equal(env.ADMIN_EMAIL, undefined);
  assert.doesNotMatch(json(container), /DB_ADMIN|MysqlSecret|manasync_admin/);
});

test('app: segredos esperados, todos do Secrets Manager', () => {
  assert.deepEqual(Object.keys(sec).sort(), ['DB_PASS', 'DB_USER', 'JWT_SECRET', 'ORIGIN_VERIFY_ATUAL', 'VALKEY_PASS']);
  assert.match(json(sec.DB_USER), /:username::/);
  assert.match(json(sec.ORIGIN_VERIFY_ATUAL), /:atual::/);
  assert.doesNotMatch(json(container.Environment), /PASS|SECRET|JWT/i);
});

test('app: configuração de produção do backend', () => {
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.PORT, '3001');
  assert.equal(env.TRUST_PROXY, '1');
  assert.equal(env.CORS_ORIGINS, '');
  assert.equal(env.DB_SSL, 'true');
  assert.equal(env.VALKEY_CLUSTER, 'true');
  assert.equal(env.VALKEY_USER, 'manasync-app');
  assert.match(json(env.VALKEY_URL), /rediss:\/\//);
  assert.equal(env.UPLOADS_BUCKET, 'manasync-imagens-111122223333-us-east-2');
  assert.equal(env.AWS_REGION, 'us-east-2');
});

test('app: tempos do desligamento sem queda cabem no stopTimeout (7.2)', () => {
  assert.equal(env.PRE_STOP_DELAY_MS, '45000');
  assert.equal(env.SHUTDOWN_TIMEOUT_MS, '10000');
  assert.equal(container.StopTimeout, 70);
  assert.ok(45 + 10 < container.StopTimeout);
});

test('app: container sem root, disco somente-leitura, /tmp efêmero, health check', () => {
  assert.equal(container.User, 'node');
  assert.equal(container.ReadonlyRootFilesystem, true);
  assert.deepEqual(container.MountPoints, [{ ContainerPath: '/tmp', ReadOnly: false, SourceVolume: 'tmp' }]);
  assert.match(container.HealthCheck.Command[1], /127\.0\.0\.1:3001\/api\/health/);
  assert.equal(td.Properties.RuntimePlatform.CpuArchitecture, 'ARM64');
});

test('app: serviço sobe a nova antes de parar a velha, com rollback, sem ECS Exec', () => {
  const svc = unico(app, 'AWS::ECS::Service').Properties;
  assert.equal(svc.DeploymentConfiguration.MinimumHealthyPercent, 100);
  assert.equal(svc.DeploymentConfiguration.MaximumPercent, 200);
  assert.deepEqual(svc.DeploymentConfiguration.DeploymentCircuitBreaker, { Enable: true, Rollback: true });
  assert.equal(svc.EnableExecuteCommand, false);
  assert.equal(svc.NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp, 'ENABLED');
});

test('app: a task só grava e apaga objetos em uploads/* — nada de ler, listar ou apagar versões (N6)', () => {
  const politicas = Object.values(app.findResources('AWS::IAM::Policy')).map((p: any) => p.Properties.PolicyDocument.Statement).flat();
  const s3 = politicas.filter((s: any) => json(s.Action).includes('s3:'));
  assert.equal(s3.length, 1);
  assert.deepEqual(s3[0].Action, ['s3:PutObject', 's3:DeleteObject']);
  assert.equal(s3[0].Resource, 'arn:aws:s3:::manasync-imagens-111122223333-us-east-2/uploads/*');
});

test('app: Lambda de DNS — Node 24, só o código no asset, variáveis certas', () => {
  const fn = unico(app, 'AWS::Lambda::Function', (p) => p.Handler === 'index.handler');
  assert.equal(fn.Properties.Runtime, 'nodejs24.x');
  const v = fn.Properties.Environment.Variables;
  assert.equal(v.RECORD_NAME, 'origin.app.mercadiastore.online');
  assert.equal(v.HOSTED_ZONE_ID, 'Z0TESTE00000000');
  assert.equal(v.TTL, '30');
  assert.ok(v.SERVICE_NAME && v.CLUSTER_ARN);
});

test('app: IAM da Lambda — só o registro de origem, só A, só CREATE/DELETE (N7)', () => {
  const papel = Object.values(app.findResources('AWS::IAM::Role')).find((r: any) => /DNS da origem/.test(r.Properties.Description ?? '')) as any;
  assert.ok(papel, 'papel próprio, não o AWSLambdaBasicExecutionRole');
  assert.equal(papel.Properties.ManagedPolicyArns, undefined);

  const statements = Object.values(app.findResources('AWS::IAM::Policy'))
    .map((p: any) => p.Properties.PolicyDocument.Statement)
    .flat();
  const troca = statements.find((s: any) => s.Sid === 'SoORegistroDeOrigem');
  assert.equal(troca.Action, 'route53:ChangeResourceRecordSets');
  assert.equal(troca.Resource, 'arn:aws:route53:::hostedzone/Z0TESTE00000000');
  const cond = troca.Condition['ForAllValues:StringEquals'];
  assert.deepEqual(cond['route53:ChangeResourceRecordSetsNormalizedRecordNames'], ['origin.app.mercadiastore.online']);
  assert.deepEqual(cond['route53:ChangeResourceRecordSetsRecordTypes'], ['A']);
  assert.deepEqual(cond['route53:ChangeResourceRecordSetsActions'], ['CREATE', 'DELETE']);

  const ecs = statements.find((s: any) => s.Sid === 'TasksDoCluster');
  assert.ok(ecs.Condition.ArnEquals['ecs:cluster'], 'ListTasks/DescribeTasks presos ao cluster');
  const logs = statements.find((s: any) => s.Sid === 'SoOProprioLog');
  assert.doesNotMatch(json(logs.Resource), /"\*"/);
});

test('app: gatilhos — mudança de task do serviço e reconciliação a cada minuto', () => {
  const regras = Object.values(app.findResources('AWS::Events::Rule')).map((r: any) => r.Properties);
  const evento = regras.find((r: any) => r.EventPattern);
  assert.deepEqual(evento.EventPattern['detail-type'], ['ECS Task State Change']);
  assert.match(json(evento.EventPattern.detail.group), /service:/);
  const agenda = regras.find((r: any) => r.ScheduleExpression);
  assert.equal(agenda.ScheduleExpression, 'rate(1 minute)');
});

test('app: alarmes com ação no tópico de alertas (e-mail do dono)', () => {
  app.resourceCountIs('AWS::CloudWatch::Alarm', 4);
  const assinatura = unico(app, 'AWS::SNS::Subscription');
  assert.equal(assinatura.Properties.Protocol, 'email');
  assert.equal(assinatura.Properties.Endpoint, 'dono@exemplo.com');
  for (const a of Object.values(app.findResources('AWS::CloudWatch::Alarm')) as any) {
    assert.equal(a.Properties.AlarmActions.length, 1);
  }
  const semTask = Object.values(app.findResources('AWS::CloudWatch::Alarm')).find((a: any) => /Nenhuma task/.test(a.Properties.AlarmDescription)) as any;
  assert.equal(semTask.Properties.TreatMissingData, 'breaching', 'sem task não há métrica: ausência precisa alarmar');
});

test('app: modo depuração liga ECS Exec e desliga o read-only (D9)', () => {
  const dep = montarTeste({ 'manasync:depuracao': true });
  const c = unico(dep.tpl.app, 'AWS::ECS::TaskDefinition').Properties.ContainerDefinitions[0];
  assert.equal(c.ReadonlyRootFilesystem, false);
  assert.equal(unico(dep.tpl.app, 'AWS::ECS::Service').Properties.EnableExecuteCommand, true);
});

test('app: rotação do segredo de origem mapeia ORIGIN_VERIFY_ANTERIOR só quando pedida', () => {
  assert.equal(sec.ORIGIN_VERIFY_ANTERIOR, undefined);
  const rot = montarTeste({ 'manasync:rotacaoOrigem': true });
  const c = unico(rot.tpl.app, 'AWS::ECS::TaskDefinition').Properties.ContainerDefinitions[0];
  assert.match(json(segredos(c).ORIGIN_VERIFY_ANTERIOR), /:anterior::/);
});

test('app: stack sem referência ao bucket da borda por export (nome determinístico)', () => {
  assert.doesNotMatch(json(td), /ExportsOutput.*Imagens/);
  assert.ok(stacks.aplicacao.dependencies.some((d) => d.stackName === 'ManaSyncBorda'), 'ainda depende da borda pelo segredo de origem');
});
