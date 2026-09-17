import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { reconhecer } from './nag';

/**
 * A rede, e a decisão de custo mais consequente do projeto.
 *
 * A task fica em **subnet pública**, não privada: um NAT Gateway (US$ 34/mês) ou
 * endpoints de interface (US$ 29/mês) custariam mais que o resto somado. O que
 * substitui esse isolamento — e precisa continuar valendo:
 *
 *   1. o SG da task só aceita a prefix list do CloudFront, na 3001;
 *   2. o backend exige o header secreto que só a nossa distribuição injeta
 *      (middleware/originVerify.js) — a prefix list sozinha deixa passar a
 *      distribuição de qualquer conta;
 *   3. banco e cache ficam em subnets isoladas e só aceitam os SGs da task (e da
 *      migração, no caso do banco);
 *   4. a saída da task é só 443 (APIs da AWS), 3306 e 6379/6380 para os SGs certos.
 *
 * O cluster ECS mora aqui porque é usado pela aplicação e pela migração, e não
 * custa nada.
 */
export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly cluster: ecs.Cluster;
  readonly sgTask: ec2.SecurityGroup;
  readonly sgMigracao: ec2.SecurityGroup;
  readonly sgBanco: ec2.SecurityGroup;
  readonly sgCache: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      // Duas AZs porque RDS e ElastiCache exigem subnet group em duas, mesmo
      // rodando single-AZ. Subnet vazia não custa nada.
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'publica', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'isolada', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      // Endpoint gateway de S3: gratuito, e o tráfego de upload e de pull de
      // camadas de imagem não sai para a internet.
      gatewayEndpoints: {
        S3: { service: ec2.GatewayVpcEndpointAwsService.S3, subnets: [{ subnetType: ec2.SubnetType.PUBLIC }] },
      },
    });

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: this.vpc,
      containerInsightsV2: ecs.ContainerInsights.DISABLED, // cobra por métrica; ligar quando houver tráfego
    });
    reconhecer(this.cluster, 'AwsSolutions-ECS4', 'Container Insights cobra por métrica; o alarme de task ausente usa a métrica padrão de CPU.');
    reconhecer(this.vpc, 'AwsSolutions-VPC7', 'Flow logs cobram por GB ingerido; fora do orçamento atual (PLANO §13).');

    this.sgTask = new ec2.SecurityGroup(this, 'SgTask', {
      vpc: this.vpc,
      description: 'Task do backend: entra so do CloudFront',
      allowAllOutbound: false,
    });
    this.sgMigracao = new ec2.SecurityGroup(this, 'SgMigracao', {
      vpc: this.vpc,
      description: 'Task de migracao: nao recebe conexao',
      allowAllOutbound: false,
    });
    this.sgBanco = new ec2.SecurityGroup(this, 'SgBanco', {
      vpc: this.vpc,
      description: 'RDS MySQL: entra so da task e da migracao',
      allowAllOutbound: false,
    });
    this.sgCache = new ec2.SecurityGroup(this, 'SgCache', {
      vpc: this.vpc,
      description: 'ElastiCache Valkey: entra so da task',
      allowAllOutbound: false,
    });

    // A lista gerenciada dos IPs de borda do CloudFront: continua correta quando
    // a AWS acrescenta pontos de presença.
    const cloudfront = ec2.PrefixList.fromLookup(this, 'CloudFrontOrigins', {
      prefixListName: 'com.amazonaws.global.cloudfront.origin-facing',
    });
    this.sgTask.addIngressRule(ec2.Peer.prefixList(cloudfront.prefixListId), ec2.Port.tcp(3001), 'HTTP so das bordas do CloudFront');

    // Saídas da task: APIs da AWS (ECR, Secrets Manager, Logs, S3) e os dois SGs de dados.
    this.sgTask.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS para APIs da AWS');
    this.sgTask.addEgressRule(this.sgBanco, ec2.Port.tcp(3306), 'MySQL');
    // O CLUSTER SLOTS do Serverless anuncia o primário (6379) e a leitura (6380).
    this.sgTask.addEgressRule(this.sgCache, ec2.Port.tcpRange(6379, 6380), 'Valkey');

    this.sgMigracao.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS para APIs da AWS');
    this.sgMigracao.addEgressRule(this.sgBanco, ec2.Port.tcp(3306), 'MySQL');

    this.sgBanco.addIngressRule(this.sgTask, ec2.Port.tcp(3306), 'MySQL a partir da task');
    this.sgBanco.addIngressRule(this.sgMigracao, ec2.Port.tcp(3306), 'MySQL a partir da migracao');
    this.sgCache.addIngressRule(this.sgTask, ec2.Port.tcpRange(6379, 6380), 'Valkey a partir da task');
  }
}
