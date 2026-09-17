import { test } from 'node:test';
import assert from 'node:assert';
import { ambiente, json, montarTeste, segredos, unico } from './ajuda';

const { tpl, stacks } = montarTeste();

const container = unico(tpl.migracao, 'AWS::ECS::TaskDefinition').Properties.ContainerDefinitions[0];
const idMaster = stacks.dados.getLogicalId(stacks.dados.segredoMaster.node.defaultChild as any);

test('migração: é a única que recebe ADMIN_EMAIL', () => {
  assert.equal(ambiente(container).ADMIN_EMAIL, 'dono@exemplo.com');
});

test('migração: credencial master e senha do usuário de app vêm do Secrets Manager', () => {
  const s = segredos(container);
  assert.deepEqual(Object.keys(s).sort(), ['APP_DB_PASS', 'DB_ADMIN_PASS', 'DB_ADMIN_USER']);
  assert.ok(json(s.DB_ADMIN_USER).includes(idMaster) || json(s.DB_ADMIN_USER).includes('Secret'));
  assert.equal(ambiente(container).APP_DB_USER, 'manasync_app');
});

test('migração: TLS verificado, sem root, disco somente-leitura', () => {
  const env = ambiente(container);
  assert.equal(env.DB_SSL, 'true');
  assert.equal(env.DB_SSL_CA_PATH, '/app/certs/rds-global-bundle.pem');
  assert.equal(container.User, 'node');
  assert.equal(container.ReadonlyRootFilesystem, true);
});

test('migração: nenhuma senha em texto no template', () => {
  assert.doesNotMatch(json(container.Environment), /PASS|SECRET/i);
});

test('migração: task ARM e sem serviço (roda avulsa)', () => {
  const td = unico(tpl.migracao, 'AWS::ECS::TaskDefinition');
  assert.equal(td.Properties.RuntimePlatform.CpuArchitecture, 'ARM64');
  tpl.migracao.resourceCountIs('AWS::ECS::Service', 0);
});
