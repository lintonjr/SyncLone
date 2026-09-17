import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';
import { DockerImageAsset, NetworkMode, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import * as path from 'path';
import { DESLIGAMENTO, ManaSyncConfig, TAMANHOS } from './config';
import { USUARIO_VALKEY_APP } from './data-stack';
import { PORTA_BACKEND, nomeBucketImagens } from './edge-stack';
import { reconhecer } from './nag';

interface AppStackProps extends StackProps {
  readonly config: ManaSyncConfig;
  readonly vpc: ec2.Vpc;
  readonly cluster: ecs.Cluster;
  readonly sgTask: ec2.SecurityGroup;
  readonly banco: rds.DatabaseInstance;
  readonly segredoAppBanco: secretsmanager.ISecret;
  readonly segredoValkey: secretsmanager.ISecret;
  readonly valkeyEndpoint: string;
  readonly valkeyPorta: string;
  readonly segredoOrigem: secretsmanager.ISecret;
}

/**
 * O backend: o serviço Fargate, o endereço fixo dele (Lambda de DNS) e os alarmes.
 *
 * É a stack que muda a cada release. Não recebe a credencial master do banco nem
 * `ADMIN_EMAIL` — isso é da migração (migration-stack.ts).
 */
export class AppStack extends Stack {
  readonly servico: ecs.FargateService;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { config, cluster } = props;

    const segredoJwt = new secretsmanager.Secret(this, 'SegredoJwt', {
      description: 'ManaSync: segredo que assina os tokens de sessao',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });
    reconhecer(segredoJwt, 'AwsSolutions-SMG4', 'Rotar o JWT derruba todas as sessões (tokens de 7 dias): rotação manual e deliberada (PLANO §4.1).');

    const imagem = new DockerImageAsset(this, 'ImagemBackend', {
      directory: path.join(__dirname, '..', '..', 'backend'),
      networkMode: NetworkMode.HOST, // VPN: a bridge do Docker não é roteada
      platform: Platform.LINUX_ARM64,
    });

    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const bucketImagens = nomeBucketImagens(config.conta, config.regiao);

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: TAMANHOS.fargate.cpu,
      memoryLimitMiB: TAMANHOS.fargate.memoryMiB,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64, // Graviton: ~20% mais barato
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    // Com o disco somente-leitura, /tmp é o único lugar gravável (efêmero).
    taskDef.addVolume({ name: 'tmp' });

    const secrets: Record<string, ecs.Secret> = {
      DB_USER: ecs.Secret.fromSecretsManager(props.segredoAppBanco, 'username'),
      DB_PASS: ecs.Secret.fromSecretsManager(props.segredoAppBanco, 'password'),
      JWT_SECRET: ecs.Secret.fromSecretsManager(segredoJwt),
      ORIGIN_VERIFY_ATUAL: ecs.Secret.fromSecretsManager(props.segredoOrigem, 'atual'),
      VALKEY_PASS: ecs.Secret.fromSecretsManager(props.segredoValkey),
    };
    // Só durante a rotação (PLANO-DEPLOY.md §4.2.3): fora dela o campo é vazio.
    if (config.rotacaoOrigem) {
      secrets.ORIGIN_VERIFY_ANTERIOR = ecs.Secret.fromSecretsManager(props.segredoOrigem, 'anterior');
    }

    const container = taskDef.addContainer('backend', {
      image: ecs.ContainerImage.fromDockerImageAsset(imagem),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'backend', logGroup }),
      // Sem root na task. No Dockerfile não: o volume local do compose é do root.
      user: 'node',
      // O ECS Exec precisa de disco gravável (D9): os dois andam juntos.
      readonlyRootFilesystem: !config.depuracao,
      environment: {
        NODE_ENV: 'production',
        // Explícito: sem ele o backend usa o padrão (7d), mas quem lê a task vê o prazo.
        JWT_EXPIRES_IN: '7d',
        PORT: String(PORTA_BACKEND),
        AWS_REGION: this.region,
        // Um salto: o CloudFront fala direto com a task.
        TRUST_PROXY: '1',
        // Vazio em produção = nenhuma origem cross-origin (SPA e API na mesma origem).
        CORS_ORIGINS: '',
        SSE_HEARTBEAT_MS: '15000',
        PRE_STOP_DELAY_MS: String(DESLIGAMENTO.preStopDelayMs),
        SHUTDOWN_TIMEOUT_MS: String(DESLIGAMENTO.shutdownTimeoutMs),
        DB_HOST: props.banco.dbInstanceEndpointAddress,
        DB_PORT: props.banco.dbInstanceEndpointPort,
        DB_NAME: 'manasync',
        DB_SSL: 'true',
        DB_SSL_CA_PATH: '/app/certs/rds-global-bundle.pem',
        VALKEY_URL: `rediss://${props.valkeyEndpoint}:${props.valkeyPorta}`,
        VALKEY_CLUSTER: 'true',
        VALKEY_USER: USUARIO_VALKEY_APP,
        UPLOADS_BUCKET: bucketImagens,
      },
      secrets,
      /**
       * Sem balanceador, este health check é o que o ECS usa para considerar a
       * task nova saudável antes de parar a velha (minHealthyPercent 100) — e o
       * que a Lambda de DNS exige para publicar o IP.
       */
      healthCheck: {
        command: ['CMD-SHELL', `node -e "fetch('http://127.0.0.1:${PORTA_BACKEND}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(30),
      },
      // PRE_STOP_DELAY_MS (45 s) + SHUTDOWN_TIMEOUT_MS (10 s) + folga.
      stopTimeout: Duration.seconds(DESLIGAMENTO.stopTimeoutS),
    });
    container.addPortMappings({ containerPort: PORTA_BACKEND });
    container.addMountPoints({ containerPath: '/tmp', sourceVolume: 'tmp', readOnly: false });

    // Só gravar e apagar imagens, só no prefixo delas (N6). Declarado à mão em vez
    // de grantPut/grantDelete: esses concedem s3:Abort*, PutObjectTagging,
    // PutObjectRetention e DeleteObject* — este último inclui apagar **versões**,
    // o que anularia o versionamento do bucket. O backend usa só estas duas.
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'ImagensEnviadas',
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: [`arn:aws:s3:::${bucketImagens}/uploads/*`],
      })
    );
    reconhecer(taskDef.taskRole, `AwsSolutions-IAM5[Resource::arn:aws:s3:::${bucketImagens}/uploads/*]`,
      'O prefixo uploads/* é o escopo mínimo: cada imagem é um objeto novo com nome uuid.');
    reconhecer(taskDef, 'AwsSolutions-IAM5[Resource::*]', 'Execution role gerada pelo CDK: ecr:GetAuthorizationToken não aceita recurso específico.');
    reconhecer(taskDef, 'AwsSolutions-ECS2', 'Ambiente só com configuração não sensível; segredos vêm do Secrets Manager (`secrets`).');

    this.servico = new ecs.FargateService(this, 'Servico', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: TAMANHOS.fargate.desiredCount,
      // IP público no lugar do NAT; a proteção é o SG (só CloudFront) + header secreto.
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [props.sgTask],
      // A nova sobe e fica saudável antes de a velha sair: deploy sem queda (7.2).
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      enableExecuteCommand: config.depuracao,
    });

    const atualizadorDns = this.criarAtualizadorDns(config, cluster);
    this.criarAlarmes(config, props.banco, atualizadorDns);

    new CfnOutput(this, 'ClusterNome', { value: cluster.clusterName });
    new CfnOutput(this, 'ServicoNome', { value: this.servico.serviceName });
    new CfnOutput(this, 'OrigemDns', { value: config.originHost });
    new CfnOutput(this, 'LogGroup', { value: logGroup.logGroupName });
  }

  /** A Lambda que mantém `origin.<domínio>` com os IPs das tasks saudáveis (7.1). */
  private criarAtualizadorDns(config: ManaSyncConfig, cluster: ecs.Cluster): lambda.Function {
    const logs_ = new logs.LogGroup(this, 'LogsAtualizadorDns', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Papel próprio em vez do AWSLambdaBasicExecutionRole, que permite escrever em
    // qualquer log group da conta.
    const papel = new iam.Role(this, 'PapelAtualizadorDns', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'ManaSync: Lambda de DNS da origem',
    });
    papel.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SoOProprioLog',
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [logs_.logGroupArn],
      })
    );

    const fn = new lambda.Function(this, 'AtualizadorDns', {
      role: papel,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      // Só o código: testes e node_modules ficam fora do zip.
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'dns-updater', 'src')),
      timeout: Duration.seconds(30),
      memorySize: 256,
      logGroup: logs_,
      description: 'ManaSync: mantem origin.<dominio> com os IPs das tasks saudaveis',
      environment: {
        CLUSTER_ARN: cluster.clusterArn,
        SERVICE_NAME: this.servico.serviceName,
        HOSTED_ZONE_ID: config.hostedZoneId,
        RECORD_NAME: config.originHost,
        TTL: String(DESLIGAMENTO.ttlDnsS),
        ESPERA_SAUDE_MS: '20000',
      },
    });

    // IAM mínimo (N7).
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'TasksDoCluster',
        actions: ['ecs:ListTasks', 'ecs:DescribeTasks'],
        resources: ['*'],
        conditions: { ArnEquals: { 'ecs:cluster': cluster.clusterArn } },
      })
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'IpDasInterfaces',
        // A API não aceita restrição por recurso.
        actions: ['ec2:DescribeNetworkInterfaces'],
        resources: ['*'],
      })
    );
    const arnZona = `arn:aws:route53:::hostedzone/${config.hostedZoneId}`;
    fn.addToRolePolicy(
      new iam.PolicyStatement({ sid: 'LerRegistro', actions: ['route53:ListResourceRecordSets'], resources: [arnZona] })
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'SoORegistroDeOrigem',
        actions: ['route53:ChangeResourceRecordSets'],
        resources: [arnZona],
        conditions: {
          'ForAllValues:StringEquals': {
            'route53:ChangeResourceRecordSetsNormalizedRecordNames': [config.originHost],
            'route53:ChangeResourceRecordSetsRecordTypes': ['A'],
            'route53:ChangeResourceRecordSetsActions': ['CREATE', 'DELETE'],
          },
        },
      })
    );

    reconhecer(papel, 'AwsSolutions-IAM5[Resource::*]',
      'ecs:ListTasks/DescribeTasks restritos pela condição ecs:cluster; ec2:DescribeNetworkInterfaces não aceita recurso.');

    const alvo = new eventsTargets.LambdaFunction(fn, { retryAttempts: 2, maxEventAge: Duration.minutes(5) });

    new events.Rule(this, 'MudancaDeTask', {
      description: 'Task do backend mudou de estado: reconciliar o DNS da origem',
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: { clusterArn: [cluster.clusterArn], group: [`service:${this.servico.serviceName}`] },
      },
      targets: [alvo],
    });

    new events.Rule(this, 'ReconciliacaoPeriodica', {
      description: 'Rede de seguranca: reconciliar o DNS da origem a cada minuto',
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [alvo],
    });

    return fn;
  }

  /** Alarmes mínimos, para o e-mail do dono (8.3). ~US$ 0,10 cada. */
  private criarAlarmes(config: ManaSyncConfig, banco: rds.DatabaseInstance, atualizadorDns: lambda.Function) {
    const topico = new sns.Topic(this, 'Alertas', { displayName: 'ManaSync alertas', enforceSSL: true });
    // A AWS manda um e-mail de confirmação no primeiro deploy.
    topico.addSubscription(new snsSubs.EmailSubscription(config.adminEmail));
    const acao = new cwActions.SnsAction(topico);

    const alarmes = [
      new cloudwatch.Alarm(this, 'SemTaskRodando', {
        alarmDescription: 'Nenhuma task do backend reportou CPU por 3 minutos (site fora do ar).',
        // Sem Container Insights não existe RunningTaskCount: sem task, não há
        // amostra de CPU — e dado ausente conta como alarme.
        metric: this.servico.metricCpuUtilization({ statistic: 'SampleCount', period: Duration.minutes(1) }),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 3,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      }),
      new cloudwatch.Alarm(this, 'BancoSemEspaco', {
        alarmDescription: 'RDS com menos de 2 GB livres.',
        metric: banco.metricFreeStorageSpace({ period: Duration.minutes(5) }),
        threshold: 2 * 1024 ** 3,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 1,
      }),
      new cloudwatch.Alarm(this, 'BancoCpuAlta', {
        alarmDescription: 'RDS acima de 80% de CPU por 15 minutos.',
        metric: banco.metricCPUUtilization({ period: Duration.minutes(5) }),
        threshold: 80,
        evaluationPeriods: 3,
      }),
      new cloudwatch.Alarm(this, 'AtualizadorDnsFalhando', {
        alarmDescription: 'A Lambda de DNS da origem falhou: o CloudFront pode estar apontando para IP errado.',
        metric: atualizadorDns.metricErrors({ period: Duration.minutes(5) }),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    ];
    for (const alarme of alarmes) alarme.addAlarmAction(acao);
  }
}
