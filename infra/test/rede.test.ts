import { test } from 'node:test';
import assert from 'node:assert';
import { json, montarTeste, unico } from './ajuda';

const { tpl, stacks } = montarTeste();
const rede = tpl.rede;

const logico = (construto: any) => stacks.rede.getLogicalId(construto.node.defaultChild);
const idTask = logico(stacks.rede.sgTask);
const idMigracao = logico(stacks.rede.sgMigracao);
const idBanco = logico(stacks.rede.sgBanco);
const idCache = logico(stacks.rede.sgCache);

/** Todas as regras (inline e recursos separados) de um SG, numa lista só. */
function regras(idSg: string, direcao: 'Ingress' | 'Egress') {
  const sg = rede.toJSON().Resources[idSg].Properties;
  const inline = (sg[`SecurityGroup${direcao}`] ?? []).map((r: any) => ({ ...r }));
  const separadas = Object.values(rede.findResources(`AWS::EC2::SecurityGroup${direcao}`))
    .map((r: any) => r.Properties)
    .filter((p: any) => json(p.GroupId).includes(idSg));
  return [...inline, ...separadas];
}

test('rede: a task só aceita a prefix list do CloudFront, só na 3001', () => {
  const entrada = regras(idTask, 'Ingress');
  assert.equal(entrada.length, 1);
  const [r] = entrada;
  assert.equal(r.FromPort, 3001);
  assert.equal(r.ToPort, 3001);
  assert.ok(r.SourcePrefixListId, 'origem precisa ser a prefix list');
  assert.equal(r.CidrIp, undefined, 'nunca 0.0.0.0/0');
});

test('rede: a task sai só por 443, 3306 (banco) e 6379-6380 (cache)', () => {
  const saida = regras(idTask, 'Egress').map((r: any) => ({
    portas: `${r.FromPort}-${r.ToPort}`,
    destino: r.CidrIp ?? json(r.DestinationSecurityGroupId),
  }));
  assert.equal(saida.length, 3);
  assert.ok(saida.some((s) => s.portas === '443-443' && s.destino === '0.0.0.0/0'));
  assert.ok(saida.some((s) => s.portas === '3306-3306' && s.destino.includes(idBanco)));
  assert.ok(saida.some((s) => s.portas === '6379-6380' && s.destino.includes(idCache)));
});

test('rede: migração não recebe conexão e sai só por 443 e 3306', () => {
  assert.equal(regras(idMigracao, 'Ingress').length, 0);
  const saida = regras(idMigracao, 'Egress');
  assert.deepEqual(saida.map((r: any) => r.FromPort).sort(), [3306, 443]);
});

test('rede: banco só aceita task e migração; cache só a task', () => {
  const banco = regras(idBanco, 'Ingress');
  assert.equal(banco.length, 2);
  assert.ok(banco.every((r: any) => r.FromPort === 3306 && !r.CidrIp));
  assert.ok(json(banco).includes(idTask) && json(banco).includes(idMigracao));

  const cache = regras(idCache, 'Ingress');
  assert.equal(cache.length, 1);
  assert.equal(cache[0].FromPort, 6379);
  assert.equal(cache[0].ToPort, 6380);
  assert.ok(json(cache).includes(idTask));
});

test('rede: sem NAT Gateway (custo) e com endpoint gateway de S3', () => {
  rede.resourceCountIs('AWS::EC2::NatGateway', 0);
  const endpoint = unico(rede, 'AWS::EC2::VPCEndpoint');
  assert.equal(endpoint.Properties.VpcEndpointType ?? 'Gateway', 'Gateway');
  assert.match(json(endpoint.Properties.ServiceName), /s3/);
});

test('rede: cluster ECS sem Container Insights', () => {
  const cluster = unico(rede, 'AWS::ECS::Cluster');
  assert.match(json(cluster.Properties.ClusterSettings), /"disabled"/);
});
