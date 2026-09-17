import { Construct } from 'constructs';

/**
 * As decisões do ambiente, num lugar só e tipadas.
 *
 * Tudo aqui é validado no synth: um valor errado para o CDK antes de qualquer
 * recurso existir. Cada regra corresponde a um defeito que já foi encontrado ou
 * previsto — ver infraestructure/aws/PLANO-DEPLOY.md.
 */

/**
 * A conta do projeto NÃO fica no código: o repositório é público. Ela vem de
 * `MANASYNC_CONTA` (no `.env` da raiz, fora do git — scripts/aws-env.sh exporta).
 */
const CONTA_VALIDA = /^[0-9]{12}$/;

/**
 * A região do projeto (AWS Settings). Todo recurso regional mora aqui; a única
 * exceção é o certificado do CloudFront, emitido fora do CDK em us-east-1.
 */
export const REGIAO = 'us-east-2';

/** Domínio raiz que não pode dar nome ao dono (`admin@…`): ver 4.3 do plano. */
const DOMINIO_RAIZ = 'mercadiastore.online';

export interface ManaSyncConfig {
  readonly conta: string;
  readonly regiao: string;
  /** Onde a SPA responde: `app.mercadiastore.online`. */
  readonly domainName: string;
  /**
   * A hosted zone do Route 53: o domínio inteiro (`mercadiastore.online`), cujos
   * servidores de nome foram trocados no registrador (PLANO D11 = C). O editor de
   * zona da HostGator não oferece registros NS, então delegar só o subdomínio não
   * foi possível.
   */
  readonly zoneName: string;
  readonly hostedZoneId: string;
  /** Certificado ACM em us-east-1, emitido por scripts/certificado.sh. */
  readonly certificateArn: string;
  /** Registro que a Lambda de DNS mantém apontando para as tasks. */
  readonly originHost: string;
  readonly env: string;
  /** Dono da plataforma: promovido pela migração e destino dos alarmes. */
  readonly adminEmail: string;
  /** Liga ECS Exec e desliga o filesystem somente-leitura (D9). */
  readonly depuracao: boolean;
  /** Mapeia ORIGIN_VERIFY_ANTERIOR na task — só durante a rotação (4.2.3). */
  readonly rotacaoOrigem: boolean;
  /**
   * Versão do segredo de origem que o CloudFront deve enviar (rotação, 4.2.3).
   *
   * O header é uma referência dinâmica ao Secrets Manager, e o CloudFormation não
   * percebe mudança no valor por trás dela: sem uma versão explícita, trocar o
   * segredo não chega à distribuição. Com ela, o texto da referência muda e o
   * CloudFormation atualiza o CloudFront.
   */
  readonly versaoSegredoOrigem?: string;
  /**
   * Dias de backup automático do RDS (point-in-time restore). Padrão 7; o plano Free
   * da conta recusa mais que 1, então o cdk.json fica em 1 até a troca para o Paid
   * (PLANO D2), que já é exigida antes de abrir ao público.
   */
  readonly backupDias: number;
}

type Contexto = (chave: string) => unknown;

function texto(ctx: Contexto, chave: string): string {
  const valor = ctx(chave);
  if (typeof valor !== 'string' || !valor.trim() || valor.startsWith('TROCAR')) {
    throw new Error(`Contexto "${chave}" não foi preenchido (cdk.json ou -c ${chave}=...).`);
  }
  return valor.trim();
}

function versao(ctx: Contexto, chave: string): string | undefined {
  const valor = ctx(chave);
  if (valor === undefined || valor === '') return undefined;
  // VersionId do Secrets Manager: um UUID.
  if (typeof valor !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor)) {
    throw new Error(`${chave} precisa ser o VersionId (UUID) do segredo, veio "${String(valor)}".`);
  }
  return valor;
}

function dias(ctx: Contexto, chave: string, padrao: number): number {
  const valor = ctx(chave);
  if (valor === undefined || valor === '') return padrao;
  const n = typeof valor === 'number' ? valor : Number(valor);
  // 0 desligaria o backup automático: fora de questão para o único banco do projeto.
  if (!Number.isInteger(n) || n < 1 || n > 35) {
    throw new Error(`${chave} precisa ser um número inteiro de 1 a 35 dias, veio "${String(valor)}".`);
  }
  return n;
}

function booleano(ctx: Contexto, chave: string): boolean {
  const valor = ctx(chave);
  return valor === true || valor === 'true';
}

export interface Contas {
  /** A conta do projeto (`MANASYNC_CONTA`). */
  readonly esperada?: string;
  /** `CDK_DEFAULT_ACCOUNT` — a conta das credenciais em uso. */
  readonly doAmbiente?: string;
}

export function lerConfig(ctx: Contexto, contas: Contas): ManaSyncConfig {
  const regiao = texto(ctx, 'manasync:region');
  if (regiao !== REGIAO) {
    throw new Error(`manasync:region precisa ser ${REGIAO} (a região do projeto), veio "${regiao}".`);
  }

  const conta = contas.esperada?.trim() ?? '';
  if (!CONTA_VALIDA.test(conta)) {
    throw new Error(
      'MANASYNC_CONTA não definida (ou não tem 12 dígitos): a conta do projeto fica no .env da raiz, ' +
        'fora do git. Rode os comandos depois de `. scripts/aws-env.sh && preparar_ambiente`.'
    );
  }
  if (contas.doAmbiente && contas.doAmbiente !== conta) {
    throw new Error(
      `As credenciais são da conta ${contas.doAmbiente}, não da conta do projeto (MANASYNC_CONTA). ` +
        'Use AWS_PROFILE=manasync.'
    );
  }

  const domainName = texto(ctx, 'manasync:domainName').toLowerCase();
  const zoneName = texto(ctx, 'manasync:zoneName').toLowerCase().replace(/\.$/, '');
  if (domainName !== zoneName && !domainName.endsWith(`.${zoneName}`)) {
    throw new Error(`manasync:domainName (${domainName}) precisa estar dentro da zona manasync:zoneName (${zoneName}).`);
  }
  if (ctx('manasync:certificateArn') === undefined) {
    throw new Error(
      'Contexto "manasync:certificateArn" não foi preenchido: rode scripts/certificado.sh --gravar ' +
        '(grava no infra/cdk.context.json, fora do git, porque o ARN leva o ID da conta).'
    );
  }
  const certificateArn = texto(ctx, 'manasync:certificateArn');
  const prefixoCert = `arn:aws:acm:us-east-1:${conta}:certificate/`;
  if (!certificateArn.startsWith(prefixoCert)) {
    throw new Error(
      'manasync:certificateArn precisa ser um certificado ACM de us-east-1 da conta do projeto ' +
        '(o CloudFront só lê certificado de lá).'
    );
  }

  const adminEmail = texto(ctx, 'manasync:adminEmail').toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
    throw new Error('manasync:adminEmail não parece um e-mail.');
  }
  const dominioEmail = adminEmail.split('@')[1];
  if (dominioEmail === DOMINIO_RAIZ || dominioEmail.endsWith(`.${DOMINIO_RAIZ}`)) {
    throw new Error(
      `manasync:adminEmail não pode ser do domínio ${DOMINIO_RAIZ}: o cadastro não confirma e-mail, ` +
        'e qualquer pessoa poderia criar essa conta antes do dono.'
    );
  }

  return {
    conta,
    regiao,
    domainName,
    zoneName,
    hostedZoneId: texto(ctx, 'manasync:hostedZoneId'),
    certificateArn,
    originHost: `origin.${domainName}`,
    env: (ctx('manasync:env') as string | undefined) ?? 'prod',
    adminEmail,
    depuracao: booleano(ctx, 'manasync:depuracao'),
    rotacaoOrigem: booleano(ctx, 'manasync:rotacaoOrigem'),
    versaoSegredoOrigem: versao(ctx, 'manasync:versaoSegredoOrigem'),
    backupDias: dias(ctx, 'manasync:backupDias', TAMANHOS.rds.backupDays),
  };
}

/** Conveniência para o app: lê do contexto do construct. */
export function loadConfig(scope: Construct, contas: Contas): ManaSyncConfig {
  return lerConfig((chave) => scope.node.tryGetContext(chave), contas);
}

/**
 * Tudo aqui é single-AZ e mínimo, de propósito (orçamento de dois dígitos).
 * Os pontos onde isso dói estão anotados em cada recurso.
 */
export const TAMANHOS = {
  /** 1 task em regime; 2 por instantes durante o deploy (minHealthy 100%). */
  fargate: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
  /** O menor Graviton do RDS; ~60 conexões, contra as 10 do pool de uma task. */
  rds: { storageGiB: 20, maxStorageGiB: 100, backupDays: 7 },
  /** Teto de gasto, não reserva: o Serverless cobra o que usa. */
  valkey: { maxStorageGiB: 1, maxEcpuPerSecond: 5000 },
} as const;

/** Tempos do desligamento sem queda (7.2): atraso + prazo + folga ≤ stopTimeout. */
export const DESLIGAMENTO = {
  preStopDelayMs: 45000,
  shutdownTimeoutMs: 10000,
  stopTimeoutS: 70,
  ttlDnsS: 30,
} as const;
