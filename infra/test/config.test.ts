import { test } from 'node:test';
import assert from 'node:assert';
import { lerConfig } from '../lib/config';
import { CONTA_TESTE, CONTEXTO_TESTE } from './ajuda';

const ler = (extra: Record<string, unknown> = {}, doAmbiente?: string, esperada: string | undefined = CONTA_TESTE) => {
  const ctx = { ...CONTEXTO_TESTE, ...extra };
  return lerConfig((k) => ctx[k], { esperada, doAmbiente });
};

test('config: contexto válido', () => {
  const c = ler();
  assert.equal(c.regiao, 'us-east-2');
  assert.equal(c.conta, CONTA_TESTE);
  assert.equal(c.originHost, 'origin.app.mercadiastore.online');
  assert.equal(c.depuracao, false);
  assert.equal(c.rotacaoOrigem, false);
});

test('config: região diferente de us-east-2 não sintetiza', () => {
  assert.throws(() => ler({ 'manasync:region': 'us-east-1' }), /us-east-2/);
  assert.throws(() => ler({ 'manasync:region': 'sa-east-1' }), /us-east-2/);
});

test('config: credenciais de outra conta não sintetizam (perfil default)', () => {
  assert.throws(() => ler({}, '444455556666'), /AWS_PROFILE=manasync/);
  assert.doesNotThrow(() => ler({}, CONTA_TESTE));
});

test('config: certificado fora de us-east-1, ou de outra conta, é recusado', () => {
  assert.throws(() => ler({ 'manasync:certificateArn': `arn:aws:acm:us-east-2:${CONTA_TESTE}:certificate/x` }), /us-east-1/);
  assert.throws(() => ler({ 'manasync:certificateArn': 'arn:aws:acm:us-east-1:444455556666:certificate/x' }), /us-east-1/);
});

test('config: valores ainda TROCAR, ou ausentes, param o synth', () => {
  assert.throws(() => ler({ 'manasync:hostedZoneId': 'TROCAR_depois_de_criar_a_zona' }), /hostedZoneId/);
  assert.throws(() => ler({ 'manasync:certificateArn': 'TROCAR_depois' }), /certificateArn/);
  assert.throws(() => ler({ 'manasync:adminEmail': undefined }), /adminEmail/);
});

test('config: e-mail do dono no próprio domínio é recusado (tomada de admin, N1)', () => {
  for (const email of ['admin@mercadiastore.online', 'dono@app.mercadiastore.online', 'x@MERCADIASTORE.online']) {
    assert.throws(() => ler({ 'manasync:adminEmail': email }), /não pode ser do domínio/, email);
  }
  assert.throws(() => ler({ 'manasync:adminEmail': 'sem-arroba' }), /e-mail/);
  assert.equal(ler({ 'manasync:adminEmail': ' Dono@Exemplo.com ' }).adminEmail, 'dono@exemplo.com');
});

test('config: flags aceitam booleano do cdk.json e texto do -c', () => {
  assert.equal(ler({ 'manasync:depuracao': true }).depuracao, true);
  assert.equal(ler({ 'manasync:depuracao': 'true' }).depuracao, true);
  assert.equal(ler({ 'manasync:rotacaoOrigem': 'false' }).rotacaoOrigem, false);
});

test('config: versão do segredo de origem precisa ser um VersionId (UUID)', () => {
  assert.equal(ler().versaoSegredoOrigem, undefined);
  assert.equal(ler({ 'manasync:versaoSegredoOrigem': '0f8fad5b-d9cb-469f-a165-70867728950e' }).versaoSegredoOrigem, '0f8fad5b-d9cb-469f-a165-70867728950e');
  assert.throws(() => ler({ 'manasync:versaoSegredoOrigem': 'AWSCURRENT' }), /VersionId/);
});

test('config: sem MANASYNC_CONTA (ou com valor inválido), não sintetiza — a conta não fica no código', () => {
  // String vazia, não undefined: undefined ativaria o valor padrão (a conta de teste).
  assert.throws(() => ler({}, undefined, ''), /MANASYNC_CONTA/);
  assert.throws(() => ler({}, undefined, '7608'), /MANASYNC_CONTA/);
  assert.throws(() => ler({}, undefined, 'conta-do-projeto'), /MANASYNC_CONTA/);
});

test('config: certificado de outra conta é recusado mesmo em us-east-1', () => {
  assert.throws(() => ler({}, undefined, '444455556666'), /certificado ACM de us-east-1 da conta do projeto/);
});
