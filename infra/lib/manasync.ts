import { App, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { AppStack } from './app-stack';
import { ManaSyncConfig } from './config';
import { DataStack } from './data-stack';
import { EdgeStack } from './edge-stack';
import { MigrationStack } from './migration-stack';
import { NetworkStack } from './network-stack';

export interface StacksManaSync {
  rede: NetworkStack;
  dados: DataStack;
  migracao: MigrationStack;
  borda: EdgeStack;
  aplicacao: AppStack;
}

/**
 * Monta as cinco stacks. Usado pelo bin/ e pelos testes — os testes validam
 * exatamente o que vai para o deploy.
 *
 * Separadas pelo ritmo com que mudam (PLANO-DEPLOY.md §8.1):
 *
 *   Rede ──► Dados ──► Migracao
 *     │        │
 *     └──► Borda ──► App (também depende de Rede e Dados)
 */
export function montar(app: App, config: ManaSyncConfig): StacksManaSync {
  const env = { account: config.conta, region: config.regiao };

  const rede = new NetworkStack(app, 'ManaSyncRede', { env, description: 'ManaSync: VPC, security groups e cluster ECS' });

  const dados = new DataStack(app, 'ManaSyncDados', {
    env,
    description: 'ManaSync: RDS MySQL 8.4 e ElastiCache Valkey Serverless',
    // Banco e cache: um `cdk destroy` por engano não pode levar os dados.
    terminationProtection: true,
    vpc: rede.vpc,
    sgBanco: rede.sgBanco,
    sgCache: rede.sgCache,
  });

  const migracao = new MigrationStack(app, 'ManaSyncMigracao', {
    env,
    description: 'ManaSync: task avulsa de migrations (credencial master do banco)',
    config,
    vpc: rede.vpc,
    cluster: rede.cluster,
    sgMigracao: rede.sgMigracao,
    banco: dados.banco,
    segredoMaster: dados.segredoMaster,
    segredoAppBanco: dados.segredoAppBanco,
  });

  const borda = new EdgeStack(app, 'ManaSyncBorda', {
    env,
    description: 'ManaSync: S3, CloudFront e Route 53',
    config,
  });

  const aplicacao = new AppStack(app, 'ManaSyncApp', {
    env,
    description: 'ManaSync: servico Fargate, atualizador de DNS e alarmes',
    config,
    vpc: rede.vpc,
    cluster: rede.cluster,
    sgTask: rede.sgTask,
    banco: dados.banco,
    segredoAppBanco: dados.segredoAppBanco,
    segredoValkey: dados.segredoValkey,
    valkeyEndpoint: dados.valkeyEndpoint,
    valkeyPorta: dados.valkeyPorta,
    segredoOrigem: borda.segredoOrigem,
  });

  Tags.of(app).add('projeto', 'manasync');
  Tags.of(app).add('ambiente', config.env);

  // Achado do AwsSolutions sem reconhecimento (lib/nag.ts) faz o synth falhar.
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
  return { rede, dados, migracao, borda, aplicacao };
}
