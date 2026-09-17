const { ECSClient, ListTasksCommand, DescribeTasksCommand } = require('@aws-sdk/client-ecs');
const { EC2Client, DescribeNetworkInterfacesCommand } = require('@aws-sdk/client-ec2');
const {
  Route53Client,
  ListResourceRecordSetsCommand,
  ChangeResourceRecordSetsCommand,
} = require('@aws-sdk/client-route-53');

/**
 * O adaptador fino entre a lógica (reconciliar.js) e o SDK.
 *
 * Só traduz: nenhuma decisão mora aqui. Os clientes são criados uma vez, fora do
 * handler, e reaproveitados entre invocações (o SDK já vem no runtime Node.js da
 * Lambda — o pacote não carrega dependência nenhuma).
 */
function criarAws({
  ecs = new ECSClient({}),
  ec2 = new EC2Client({}),
  route53 = new Route53Client({}),
} = {}) {
  return {
    async listarTasks(cluster, servico) {
      const arns = [];
      let nextToken;
      do {
        const r = await ecs.send(
          new ListTasksCommand({ cluster, serviceName: servico, desiredStatus: 'RUNNING', nextToken })
        );
        arns.push(...(r.taskArns ?? []));
        nextToken = r.nextToken;
      } while (nextToken);
      return arns;
    },

    async descreverTasks(cluster, arns) {
      const tasks = [];
      // DescribeTasks aceita até 100 por chamada.
      for (let i = 0; i < arns.length; i += 100) {
        const r = await ecs.send(new DescribeTasksCommand({ cluster, tasks: arns.slice(i, i + 100) }));
        tasks.push(...(r.tasks ?? []));
      }
      return tasks;
    },

    async ipsPublicos(enis) {
      const r = await ec2.send(new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: enis }));
      return (r.NetworkInterfaces ?? []).map((n) => n.Association?.PublicIp).filter(Boolean);
    },

    /** O registro A atual, ou null. `valores` sempre ordenado. */
    async lerRegistro(zona, nome) {
      const r = await route53.send(
        new ListResourceRecordSetsCommand({
          HostedZoneId: zona,
          StartRecordName: nome,
          StartRecordType: 'A',
          MaxItems: 1,
        })
      );
      const conjunto = r.ResourceRecordSets?.[0];
      const mesmoNome = conjunto && conjunto.Name.toLowerCase().replace(/\.$/, '') === nome;
      if (!mesmoNome || conjunto.Type !== 'A' || !conjunto.ResourceRecords) return null;
      return {
        ttl: conjunto.TTL,
        valores: conjunto.ResourceRecords.map((rr) => rr.Value).sort(),
      };
    },

    /**
     * Troca atômica: DELETE dos valores lidos + CREATE dos novos, num lote só.
     * Sem registro anterior, só CREATE — que também falha se outra execução
     * acabou de criar. Em ambos os casos o erro é `InvalidChangeBatch`.
     */
    async trocarRegistro(zona, nome, { anterior, valores, ttl }) {
      const conjunto = (vals, t) => ({
        Name: nome,
        Type: 'A',
        TTL: t,
        ResourceRecords: vals.map((Value) => ({ Value })),
      });
      const Changes = [];
      if (anterior) Changes.push({ Action: 'DELETE', ResourceRecordSet: conjunto(anterior.valores, anterior.ttl) });
      Changes.push({ Action: 'CREATE', ResourceRecordSet: conjunto(valores, ttl) });

      await route53.send(
        new ChangeResourceRecordSetsCommand({
          HostedZoneId: zona,
          ChangeBatch: { Comment: 'ManaSync: IPs das tasks saudáveis do backend', Changes },
        })
      );
    },
  };
}

module.exports = { criarAws };
