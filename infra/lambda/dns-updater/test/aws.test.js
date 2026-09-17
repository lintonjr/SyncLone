const test = require('node:test');
const assert = require('node:assert');
const { criarAws } = require('../src/aws');

/** Cliente de mentira: registra os comandos e responde com o que o teste mandar. */
function umCliente(responder = () => ({})) {
  const c = { enviados: [] };
  c.send = async (comando) => {
    c.enviados.push({ tipo: comando.constructor.name, input: comando.input });
    return responder(comando.constructor.name, comando.input, c.enviados.length);
  };
  return c;
}

test('aws: listarTasks segue a paginação e filtra por serviço e RUNNING', async () => {
  const ecs = umCliente((_, input) =>
    input.nextToken ? { taskArns: ['t3'] } : { taskArns: ['t1', 't2'], nextToken: 'pag2' }
  );
  const arns = await criarAws({ ecs }).listarTasks('cluster-x', 'servico-y');
  assert.deepEqual(arns, ['t1', 't2', 't3']);
  assert.deepEqual(ecs.enviados[0], {
    tipo: 'ListTasksCommand',
    input: { cluster: 'cluster-x', serviceName: 'servico-y', desiredStatus: 'RUNNING', nextToken: undefined },
  });
  assert.equal(ecs.enviados[1].input.nextToken, 'pag2');
});

test('aws: descreverTasks divide em lotes de 100', async () => {
  const ecs = umCliente((_, input) => ({ tasks: input.tasks.map((taskArn) => ({ taskArn })) }));
  const arns = Array.from({ length: 150 }, (_, i) => `t${i}`);
  const tasks = await criarAws({ ecs }).descreverTasks('c', arns);
  assert.equal(tasks.length, 150);
  assert.deepEqual(ecs.enviados.map((e) => e.input.tasks.length), [100, 50]);
});

test('aws: ipsPublicos ignora ENI sem IP público', async () => {
  const ec2 = umCliente(() => ({
    NetworkInterfaces: [{ Association: { PublicIp: '1.1.1.1' } }, {}, { Association: {} }],
  }));
  assert.deepEqual(await criarAws({ ec2 }).ipsPublicos(['eni-1', 'eni-2', 'eni-3']), ['1.1.1.1']);
  assert.deepEqual(ec2.enviados[0].input, { NetworkInterfaceIds: ['eni-1', 'eni-2', 'eni-3'] });
});

test('aws: lerRegistro normaliza o ponto final e ordena os valores', async () => {
  const route53 = umCliente(() => ({
    ResourceRecordSets: [
      { Name: 'origin.app.exemplo.com.', Type: 'A', TTL: 30, ResourceRecords: [{ Value: '3.3.3.3' }, { Value: '1.1.1.1' }] },
    ],
  }));
  const r = await criarAws({ route53 }).lerRegistro('Z', 'origin.app.exemplo.com');
  assert.deepEqual(r, { ttl: 30, valores: ['1.1.1.1', '3.3.3.3'] });
  assert.deepEqual(route53.enviados[0].input, {
    HostedZoneId: 'Z',
    StartRecordName: 'origin.app.exemplo.com',
    StartRecordType: 'A',
    MaxItems: 1,
  });
});

test('aws: lerRegistro devolve null quando o próximo registro é outro nome ou outro tipo', async () => {
  // ListResourceRecordSets começa no nome pedido e devolve o seguinte se ele não existe.
  for (const conjunto of [
    { Name: 'outro.app.exemplo.com.', Type: 'A', TTL: 30, ResourceRecords: [{ Value: '1.1.1.1' }] },
    { Name: 'origin.app.exemplo.com.', Type: 'AAAA', TTL: 30, ResourceRecords: [{ Value: '::1' }] },
    { Name: 'origin.app.exemplo.com.', Type: 'A', AliasTarget: {} },
  ]) {
    const route53 = umCliente(() => ({ ResourceRecordSets: [conjunto] }));
    assert.equal(await criarAws({ route53 }).lerRegistro('Z', 'origin.app.exemplo.com'), null);
  }
  const vazio = umCliente(() => ({ ResourceRecordSets: [] }));
  assert.equal(await criarAws({ route53: vazio }).lerRegistro('Z', 'origin.app.exemplo.com'), null);
});

test('aws: trocarRegistro com anterior é DELETE exato + CREATE, num lote só', async () => {
  const route53 = umCliente();
  await criarAws({ route53 }).trocarRegistro('Z', 'origin.app.exemplo.com', {
    anterior: { ttl: 60, valores: ['1.1.1.1'] },
    valores: ['1.1.1.1', '2.2.2.2'],
    ttl: 30,
  });
  assert.equal(route53.enviados.length, 1);
  const { tipo, input } = route53.enviados[0];
  assert.equal(tipo, 'ChangeResourceRecordSetsCommand');
  assert.equal(input.HostedZoneId, 'Z');
  assert.deepEqual(input.ChangeBatch.Changes, [
    {
      Action: 'DELETE',
      ResourceRecordSet: { Name: 'origin.app.exemplo.com', Type: 'A', TTL: 60, ResourceRecords: [{ Value: '1.1.1.1' }] },
    },
    {
      Action: 'CREATE',
      ResourceRecordSet: {
        Name: 'origin.app.exemplo.com',
        Type: 'A',
        TTL: 30,
        ResourceRecords: [{ Value: '1.1.1.1' }, { Value: '2.2.2.2' }],
      },
    },
  ]);
});

test('aws: trocarRegistro sem anterior é só CREATE (nunca UPSERT)', async () => {
  const route53 = umCliente();
  await criarAws({ route53 }).trocarRegistro('Z', 'origin.app.exemplo.com', { anterior: null, valores: ['1.1.1.1'], ttl: 30 });
  assert.deepEqual(route53.enviados[0].input.ChangeBatch.Changes.map((c) => c.Action), ['CREATE']);
});

test('aws: erro do SDK sobe sem ser engolido (a lógica decide se repete)', async () => {
  const route53 = umCliente(() => {
    throw Object.assign(new Error('not found'), { name: 'InvalidChangeBatch' });
  });
  await assert.rejects(
    criarAws({ route53 }).trocarRegistro('Z', 'n', { anterior: null, valores: ['1.1.1.1'], ttl: 30 }),
    (err) => err.name === 'InvalidChangeBatch'
  );
});
