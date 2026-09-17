import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { lerConfig } from '../lib/config';
import { montar, StacksManaSync } from '../lib/manasync';

/** Conta fictícia (padrão dos exemplos da AWS). A real fica fora do git. */
export const CONTA_TESTE = '111122223333';

/** Contexto fictício, mas válido: o mesmo formato do cdk.json preenchido. */
export const CONTEXTO_TESTE: Record<string, unknown> = {
  'manasync:region': 'us-east-2',
  'manasync:domainName': 'app.mercadiastore.online',
  'manasync:hostedZoneId': 'Z0TESTE00000000',
  'manasync:certificateArn': `arn:aws:acm:us-east-1:${CONTA_TESTE}:certificate/00000000-0000-4000-8000-000000000000`,
  'manasync:adminEmail': 'dono@exemplo.com',
  'manasync:env': 'prod',
};

export interface Montagem {
  app: App;
  stacks: StacksManaSync;
  tpl: { rede: Template; dados: Template; migracao: Template; borda: Template; app: Template };
}

/**
 * Monta o app exatamente como o bin/ faz, com contexto de teste. Sem credenciais:
 * os lookups (prefix list, AZs) devolvem valores fictícios do CDK.
 */
export function montarTeste(extra: Record<string, unknown> = {}): Montagem {
  const contexto = { ...CONTEXTO_TESTE, ...extra };
  const app = new App({ context: contexto });
  const stacks = montar(app, lerConfig((k) => contexto[k], { esperada: CONTA_TESTE }));
  return {
    app,
    stacks,
    tpl: {
      rede: Template.fromStack(stacks.rede),
      dados: Template.fromStack(stacks.dados),
      migracao: Template.fromStack(stacks.migracao),
      borda: Template.fromStack(stacks.borda),
      app: Template.fromStack(stacks.aplicacao),
    },
  };
}

/** O único recurso de um tipo (falha se houver zero ou mais de um). */
export function unico(tpl: Template, tipo: string, filtro: (props: any) => boolean = () => true): any {
  const achados = Object.values(tpl.findResources(tipo)).filter((r: any) => filtro(r.Properties ?? {}));
  if (achados.length !== 1) throw new Error(`esperava 1 ${tipo}, achei ${achados.length}`);
  return achados[0];
}

/** Variáveis de ambiente de um container, como objeto. */
export const ambiente = (container: any): Record<string, unknown> =>
  Object.fromEntries((container.Environment ?? []).map((e: any) => [e.Name, e.Value]));

/** Segredos de um container, como objeto nome → ValueFrom. */
export const segredos = (container: any): Record<string, unknown> =>
  Object.fromEntries((container.Secrets ?? []).map((e: any) => [e.Name, e.ValueFrom]));

/** Serializa para busca de texto (referências entre recursos, ARNs). */
export const json = (valor: unknown) => JSON.stringify(valor);
