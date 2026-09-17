import { test } from 'node:test';
import assert from 'node:assert';
import { App } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { lerConfig } from '../lib/config';
import { montar } from '../lib/manasync';
import { CONTA_TESTE, CONTEXTO_TESTE } from './ajuda';

const novoApp = () => {
  const app = new App({ context: CONTEXTO_TESTE });
  const stacks = montar(app, lerConfig((k) => CONTEXTO_TESTE[k], { esperada: CONTA_TESTE }));
  return { app, stacks };
};

test('nag: o app inteiro sintetiza sem achado do AwsSolutions sem reconhecimento', () => {
  const { app } = novoApp();
  assert.doesNotThrow(() => app.synth());
});

test('nag: o plugin está ativo — um SG aberto ao mundo faz o synth falhar', () => {
  const { app, stacks } = novoApp();
  const sg = new ec2.SecurityGroup(stacks.rede, 'SgPerigoso', { vpc: stacks.rede.vpc });
  sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic(), 'aberto');
  assert.throws(() => app.synth(), /Validation failed/);
});

/**
 * Inventário aprovado de reconhecimentos do cdk-nag: construto × regra.
 *
 * Todo reconhecimento novo — ou aplicado num construto diferente — quebra este
 * teste até ser acrescentado aqui, conscientemente. O motivo de cada um está ao
 * lado do código, em `reconhecer(...)`.
 */
const APROVADOS = [
  'ManaSyncApp/PapelAtualizadorDns AwsSolutions-IAM5[Resource::*]',
  'ManaSyncApp/SegredoJwt AwsSolutions-SMG4',
  'ManaSyncApp/TaskDef AwsSolutions-ECS2',
  'ManaSyncApp/TaskDef AwsSolutions-IAM5[Resource::*]',
  'ManaSyncApp/TaskDef/TaskRole AwsSolutions-IAM5[Resource::arn:aws:s3:::manasync-imagens-111122223333-us-east-2/uploads/*]',
  'ManaSyncBorda/Distribuicao AwsSolutions-CFR1',
  'ManaSyncBorda/Distribuicao AwsSolutions-CFR2',
  'ManaSyncBorda/Distribuicao AwsSolutions-CFR3',
  'ManaSyncBorda/Distribuicao AwsSolutions-CFR5',
  'ManaSyncBorda/Imagens AwsSolutions-S1',
  'ManaSyncBorda/SegredoOrigem AwsSolutions-SMG4',
  'ManaSyncBorda/Spa AwsSolutions-S1',
  'ManaSyncDados/LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
  'ManaSyncDados/LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a AwsSolutions-IAM5[Resource::*]',
  'ManaSyncDados/Mysql AwsSolutions-RDS11',
  'ManaSyncDados/Mysql AwsSolutions-RDS3',
  'ManaSyncDados/Mysql/Secret AwsSolutions-SMG4',
  'ManaSyncDados/SegredoAppBanco AwsSolutions-SMG4',
  'ManaSyncDados/SegredoValkey AwsSolutions-SMG4',
  'ManaSyncDados/SegredoValkeyDefault AwsSolutions-SMG4',
  'ManaSyncMigracao/TaskDef AwsSolutions-ECS2',
  'ManaSyncMigracao/TaskDef AwsSolutions-IAM5[Resource::*]',
  // Gerado pelo próprio aws-cdk-lib (lookup de AZs), não por lib/nag.ts.
  'ManaSyncRede CloudFormation-Validate::W3010',
  'ManaSyncRede/Cluster AwsSolutions-ECS4',
  'ManaSyncRede/Vpc AwsSolutions-VPC7',
];

test('nag: reconhecimentos são exatamente os aprovados — nenhum a mais, nenhum no lugar errado', () => {
  const { app } = novoApp();
  const atuais: string[] = [];
  for (const c of app.node.findAll()) {
    for (const m of c.node.metadata) {
      if (m.type !== 'aws:cdk:acknowledged-rules') continue;
      for (const regra of Object.keys(m.data as object)) atuais.push(`${c.node.path} ${regra.replace('AwsSolutions::', '')}`);
    }
  }
  assert.deepEqual(atuais.sort(), [...APROVADOS].sort());
});

test('nag: nenhum reconhecimento no nível de stack (esconderia achados de recursos novos)', () => {
  const { stacks } = novoApp();
  for (const stack of Object.values(stacks)) {
    const naStack = stack.node.metadata
      .filter((m: { type: string }) => m.type === 'aws:cdk:acknowledged-rules')
      .flatMap((m: { data: unknown }) => Object.keys(m.data as object))
      .filter((r: string) => r.startsWith('AwsSolutions'));
    assert.deepEqual(naStack, [], stack.stackName);
  }
});
