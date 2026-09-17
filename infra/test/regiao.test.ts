import { test } from 'node:test';
import assert from 'node:assert';
import { REGIAO } from '../lib/config';
import { CONTA_TESTE, json, montarTeste } from './ajuda';

const { tpl, stacks } = montarTeste();

test('região: todas as stacks na conta e região do projeto', () => {
  for (const stack of Object.values(stacks)) {
    assert.equal(stack.region, REGIAO, stack.stackName);
    assert.equal(stack.account, CONTA_TESTE, stack.stackName);
  }
});

test('região: us-east-1 só aparece no ARN do certificado do CloudFront', () => {
  for (const [nome, template] of Object.entries(tpl)) {
    const texto = json(template.toJSON());
    const ocorrencias = texto.match(/us-east-1[^"]*/g) ?? [];
    const fora = ocorrencias.filter((o) => !o.startsWith(`us-east-1:${CONTA_TESTE}:certificate/`));
    assert.deepEqual(fora, [], `${nome}: us-east-1 fora do certificado`);
  }
});

test('região: nenhum recurso regional com região explícita diferente', () => {
  for (const [nome, template] of Object.entries(tpl)) {
    const texto = json(template.toJSON());
    for (const outra of ['sa-east-1', 'us-west-1', 'us-west-2', 'eu-west-1']) {
      assert.ok(!texto.includes(outra), `${nome} menciona ${outra}`);
    }
  }
});
