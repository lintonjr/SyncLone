import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { TAMANHOS } from './config';
import { reconhecer } from './nag';

interface DataStackProps extends StackProps {
  readonly vpc: ec2.Vpc;
  readonly sgBanco: ec2.SecurityGroup;
  readonly sgCache: ec2.SecurityGroup;
  /** Dias de backup automático do RDS (`manasync:backupDias`). */
  readonly backupDias: number;
}

/**
 * Permissões do usuário do backend no Valkey — **validadas contra o ElastiCache
 * Serverless** no spike do PR 3 (PLANO-DEPLOY.md §5.2). `+cluster|info` não é
 * opcional: o cliente cluster do ioredis faz o ready check com ele e, sem a
 * permissão, desiste sem emitir erro nenhum.
 */
export const ACESSO_VALKEY_APP =
  'on ~rl:* &evento:* -@all +@connection +info +cluster|info +cluster|slots +cluster|shards ' +
  '+ssubscribe +sunsubscribe +spublish +multi +exec +incr +decr +pexpire +pttl +del';

/** Nome do usuário do backend no Valkey (VALKEY_USER). */
export const USUARIO_VALKEY_APP = 'manasync-app';

/**
 * Banco gerenciado e cache.
 *
 * Os dois vivem em subnet isolada — sem rota para a internet, nem de saída.
 */
export class DataStack extends Stack {
  readonly banco: rds.DatabaseInstance;
  /** Credencial master: só a task de migração lê. */
  readonly segredoMaster: secretsmanager.ISecret;
  /** `{ username: manasync_app, password }`: o backend conecta com ela (3.3). */
  readonly segredoAppBanco: secretsmanager.Secret;
  readonly segredoValkey: secretsmanager.Secret;
  readonly valkeyEndpoint: string;
  readonly valkeyPorta: string;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const engine = rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_4_10 });

    /**
     * `require_secure_transport=ON` faz o servidor **recusar** conexão sem TLS —
     * o par do `DB_SSL=true` no backend e na migração.
     */
    const parametros = new rds.ParameterGroup(this, 'Parametros', {
      engine,
      description: 'ManaSync: TLS obrigatorio, UTC, utf8mb4',
      parameters: {
        require_secure_transport: 'ON',
        time_zone: 'UTC',
        character_set_server: 'utf8mb4',
        collation_server: 'utf8mb4_unicode_ci',
      },
    });

    this.banco = new rds.DatabaseInstance(this, 'Mysql', {
      engine,
      // 8.4 LTS: a 8.0 saiu do suporte padrão em 31/07/2026 (Extended Support é cobrado à parte).
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MICRO),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.sgBanco],
      parameterGroup: parametros,
      databaseName: 'manasync',
      credentials: rds.Credentials.fromGeneratedSecret('manasync_admin'),

      allocatedStorage: TAMANHOS.rds.storageGiB,
      maxAllocatedStorage: TAMANHOS.rds.maxStorageGiB, // disco cheio em banco é queda, não lentidão
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,

      multiAz: false, // combinado: sem Multi-AZ por enquanto (~US$ 12/mês)
      publiclyAccessible: false,
      autoMinorVersionUpgrade: true,
      backupRetention: Duration.days(props.backupDias),
      // Madrugada no Brasil (UTC-3), fora de torneio.
      preferredBackupWindow: '06:00-07:00',
      preferredMaintenanceWindow: 'Sun:07:00-Sun:08:00',
      deleteAutomatedBackups: false,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,

      cloudwatchLogsExports: ['error', 'slowquery'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_WEEK,
    });
    this.segredoMaster = this.banco.secret!;
    reconhecer(this.banco, 'AwsSolutions-RDS3', 'Single-AZ por custo (D2); backups de 7 dias e snapshot antes de cada migração.');
    reconhecer(this.banco, 'AwsSolutions-RDS11', 'Porta 3306: a proteção é a subnet isolada e o SG que só aceita task e migração.');
    // O custom resource de retenção de logs é do próprio CDK (cloudwatchLogsRetention).
    // Reconhecido nele, e não na stack: na stack esconderia qualquer IAM curinga novo.
    const logRetention = this.node.children.find((c) => c.node.id.startsWith('LogRetention'));
    if (!logRetention) throw new Error('custom resource LogRetention não encontrado — o aws-cdk-lib mudou?');
    reconhecer(logRetention, 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
      'Custom resource LogRetention gerado pelo aws-cdk-lib.');
    reconhecer(logRetention, 'AwsSolutions-IAM5[Resource::*]', 'Custom resource LogRetention gerado pelo aws-cdk-lib: logs:PutRetentionPolicy em "*".');
    // `banco.secret` é o anexo ao RDS; o segredo em si é o filho `Secret` da instância.
    reconhecer(this.banco.node.findChild('Secret'), 'AwsSolutions-SMG4',
      'Só a task de migração lê o master; rotação automática exigiria Lambda de rotação e coordenação com a migração.');

    this.segredoAppBanco = new secretsmanager.Secret(this, 'SegredoAppBanco', {
      description: 'ManaSync: usuario do backend no MySQL (so DML), criado pela migracao',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'manasync_app' }),
        generateStringKey: 'password',
        passwordLength: 40,
        // Fora o que complica SQL e URL; o runner usa placeholders, isto é só folga.
        excludeCharacters: '\'"\\/@ `',
      },
    });
    reconhecer(this.segredoAppBanco, 'AwsSolutions-SMG4',
      'Rotação pela migração: ela reescreve a senha do usuário de app a cada execução (PLANO §3.3).');

    // --- Valkey Serverless + RBAC -------------------------------------------

    this.segredoValkey = new secretsmanager.Secret(this, 'SegredoValkey', {
      description: 'ManaSync: senha do usuario manasync-app no Valkey',
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
    });
    reconhecer(this.segredoValkey, 'AwsSolutions-SMG4', 'Rotação manual: trocar a senha exige atualizar o usuário do Valkey e reiniciar as tasks juntos.');

    // O engine Valkey recusa `no-password-required` (spike): o `default` recebe
    // uma senha que ninguém usa e fica desligado.
    const segredoValkeyDefault = new secretsmanager.Secret(this, 'SegredoValkeyDefault', {
      description: 'ManaSync: senha descartavel do usuario default (desligado) do Valkey',
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
    });
    reconhecer(segredoValkeyDefault, 'AwsSolutions-SMG4', 'Senha de um usuário desligado (off -@all), que ninguém usa.');

    const usuarioDefault = new elasticache.CfnUser(this, 'ValkeyUsuarioDefault', {
      engine: 'valkey',
      userId: 'manasync-default-off',
      userName: 'default',
      accessString: 'off -@all',
      authenticationMode: { Type: 'password', Passwords: [segredoValkeyDefault.secretValue.unsafeUnwrap()] },
    });

    const usuarioApp = new elasticache.CfnUser(this, 'ValkeyUsuarioApp', {
      engine: 'valkey',
      userId: 'manasync-app',
      userName: USUARIO_VALKEY_APP,
      accessString: ACESSO_VALKEY_APP,
      authenticationMode: { Type: 'password', Passwords: [this.segredoValkey.secretValue.unsafeUnwrap()] },
    });

    const grupo = new elasticache.CfnUserGroup(this, 'ValkeyGrupo', {
      engine: 'valkey',
      userGroupId: 'manasync-usuarios',
      userIds: [usuarioDefault.userId, usuarioApp.userId],
    });
    grupo.addResourceDependency(usuarioDefault);
    grupo.addResourceDependency(usuarioApp);

    const cache = new elasticache.CfnServerlessCache(this, 'Valkey', {
      engine: 'valkey',
      majorEngineVersion: '8',
      serverlessCacheName: `manasync-${this.region}`,
      description: 'ManaSync: pub/sub do SSE e store do rate limit',
      securityGroupIds: [props.sgCache.securityGroupId],
      subnetIds: props.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
      userGroupId: grupo.userGroupId,
      cacheUsageLimits: {
        dataStorage: { maximum: TAMANHOS.valkey.maxStorageGiB, unit: 'GB' },
        ecpuPerSecond: { maximum: TAMANHOS.valkey.maxEcpuPerSecond },
      },
    });
    cache.addResourceDependency(grupo);

    this.valkeyEndpoint = cache.attrEndpointAddress;
    this.valkeyPorta = cache.attrEndpointPort;

    new CfnOutput(this, 'BancoEndpoint', { value: this.banco.dbInstanceEndpointAddress });
    new CfnOutput(this, 'BancoInstancia', { value: this.banco.instanceIdentifier });
    new CfnOutput(this, 'ValkeyEndpoint', { value: `${this.valkeyEndpoint}:${this.valkeyPorta}` });
  }
}
