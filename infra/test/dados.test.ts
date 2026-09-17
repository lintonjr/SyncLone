import { test } from 'node:test';
import assert from 'node:assert';
import { ACESSO_VALKEY_APP } from '../lib/data-stack';
import { json, montarTeste, unico } from './ajuda';

const { tpl, stacks } = montarTeste();
const dados = tpl.dados;

test('dados: RDS MySQL 8.4, privado, cifrado, protegido e com TLS obrigatório', () => {
  const rds = unico(dados, 'AWS::RDS::DBInstance');
  const p = rds.Properties;
  assert.equal(p.Engine, 'mysql');
  assert.match(p.EngineVersion, /^8\.4\./, 'a 8.0 está em Extended Support (cobrado)');
  assert.equal(p.PubliclyAccessible, false);
  assert.equal(p.StorageEncrypted, true);
  assert.equal(p.DeletionProtection, true);
  assert.equal(rds.DeletionPolicy, 'Retain');
  assert.equal(p.DBInstanceClass, 'db.t4g.micro');

  const params = unico(dados, 'AWS::RDS::DBParameterGroup');
  assert.equal(params.Properties.Parameters.require_secure_transport, 'ON');
  assert.match(params.Properties.Family, /mysql8\.4/);
});

test('dados: stack com proteção contra exclusão', () => {
  assert.equal(stacks.dados.terminationProtection, true);
});

test('dados: segredo do usuário de app separado do master, só com DML (manasync_app)', () => {
  const app = unico(dados, 'AWS::SecretsManager::Secret', (p) => /usuario do backend/.test(p.Description ?? ''));
  const gerado = app.Properties.GenerateSecretString;
  assert.equal(JSON.parse(gerado.SecretStringTemplate).username, 'manasync_app');
  assert.equal(gerado.GenerateStringKey, 'password');
});

test('dados: Valkey Serverless com grupo de usuários (RBAC)', () => {
  const cache = unico(dados, 'AWS::ElastiCache::ServerlessCache');
  assert.equal(cache.Properties.Engine, 'valkey');
  assert.equal(cache.Properties.MajorEngineVersion, '8');
  assert.ok(cache.Properties.UserGroupId, 'sem grupo, o cache aceita qualquer conexão do SG');
  assert.deepEqual(cache.Properties.CacheUsageLimits.DataStorage, { Maximum: 1, Unit: 'GB' });
});

test('dados: usuário default desligado e com senha (o engine Valkey recusa no-password)', () => {
  const def = unico(dados, 'AWS::ElastiCache::User', (p) => p.UserName === 'default');
  assert.equal(def.Properties.Engine, 'valkey');
  assert.equal(def.Properties.AccessString, 'off -@all');
  assert.equal(def.Properties.AuthenticationMode.Type, 'password');
  assert.match(json(def.Properties.AuthenticationMode.Passwords), /resolve:secretsmanager/);
});

test('dados: usuário do app com a lista de permissões validada no spike (inclui cluster|info)', () => {
  const app = unico(dados, 'AWS::ElastiCache::User', (p) => p.UserName === 'manasync-app');
  assert.equal(app.Properties.AccessString, ACESSO_VALKEY_APP);
  assert.match(ACESSO_VALKEY_APP, /\+cluster\|info/);
  assert.match(ACESSO_VALKEY_APP, /-@all/);
  assert.doesNotMatch(ACESSO_VALKEY_APP, /\+@all|~\*|&\*|flushall|keys/i);
  // Senha como referência dinâmica: nunca em texto no template.
  assert.match(json(app.Properties.AuthenticationMode.Passwords), /resolve:secretsmanager/);
});

test('dados: retenção de backup do RDS vem do contexto (1 dia no plano Free)', () => {
  assert.equal(unico(dados, 'AWS::RDS::DBInstance').Properties.BackupRetentionPeriod, 7);
  const free = montarTeste({ 'manasync:backupDias': 1 });
  assert.equal(unico(free.tpl.dados, 'AWS::RDS::DBInstance').Properties.BackupRetentionPeriod, 1);
});
