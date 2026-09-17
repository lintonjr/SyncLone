import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { DockerImageAsset, NetworkMode, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import * as path from 'path';
import { ManaSyncConfig } from './config';
import { reconhecer } from './nag';

interface MigrationStackProps extends StackProps {
  readonly config: ManaSyncConfig;
  readonly vpc: ec2.Vpc;
  readonly cluster: ecs.Cluster;
  readonly sgMigracao: ec2.SecurityGroup;
  readonly banco: rds.DatabaseInstance;
  readonly segredoMaster: secretsmanager.ISecret;
  readonly segredoAppBanco: secretsmanager.ISecret;
}

/**
 * A task avulsa que aplica schema e migrations (db/, PR 4).
 *
 * Separada do serviço de propósito (D5): é o **único** lugar que lê a credencial
 * master do banco e o único que recebe `ADMIN_EMAIL`. A task do backend não tem
 * nenhum dos dois — uma falha explorável na API não vira `DROP TABLE` nem
 * promoção a admin.
 *
 * Não há serviço: `scripts/migrar.sh` roda a task com `aws ecs run-task`, espera e
 * aborta o deploy se o código de saída não for 0.
 */
export class MigrationStack extends Stack {
  readonly taskDef: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: MigrationStackProps) {
    super(scope, id, props);
    const { config } = props;

    const imagem = new DockerImageAsset(this, 'ImagemMigracao', {
      directory: path.join(__dirname, '..', '..', 'db'),
      // A bridge do Docker não é roteada com a VPN ligada (ver memória do projeto).
      networkMode: NetworkMode.HOST,
      platform: Platform.LINUX_ARM64,
    });

    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    this.taskDef.addContainer('migracao', {
      image: ecs.ContainerImage.fromDockerImageAsset(imagem),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'migracao', logGroup }),
      user: 'node',
      // O runner não escreve em disco.
      readonlyRootFilesystem: true,
      environment: {
        NODE_ENV: 'production',
        DB_HOST: props.banco.dbInstanceEndpointAddress,
        DB_PORT: props.banco.dbInstanceEndpointPort,
        DB_NAME: 'manasync',
        DB_SSL: 'true',
        DB_SSL_CA_PATH: '/app/certs/rds-global-bundle.pem',
        APP_DB_USER: 'manasync_app',
        ADMIN_EMAIL: config.adminEmail,
      },
      secrets: {
        DB_ADMIN_USER: ecs.Secret.fromSecretsManager(props.segredoMaster, 'username'),
        DB_ADMIN_PASS: ecs.Secret.fromSecretsManager(props.segredoMaster, 'password'),
        APP_DB_PASS: ecs.Secret.fromSecretsManager(props.segredoAppBanco, 'password'),
      },
    });

    reconhecer(this.taskDef, 'AwsSolutions-IAM5[Resource::*]', 'Execution role gerada pelo CDK: ecr:GetAuthorizationToken não aceita recurso específico.');
    reconhecer(this.taskDef, 'AwsSolutions-ECS2', 'Ambiente só com configuração não sensível (inclui ADMIN_EMAIL, que não é segredo); credenciais vêm do Secrets Manager.');

    new CfnOutput(this, 'TaskDefArn', { value: this.taskDef.taskDefinitionArn });
    new CfnOutput(this, 'ClusterArn', { value: props.cluster.clusterArn });
    new CfnOutput(this, 'SgMigracao', { value: props.sgMigracao.securityGroupId });
    new CfnOutput(this, 'SubnetsPublicas', {
      value: props.vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }).subnetIds.join(','),
    });
    new CfnOutput(this, 'LogGroup', { value: logGroup.logGroupName });
  }
}
