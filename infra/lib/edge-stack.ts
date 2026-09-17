import { CfnOutput, Duration, RemovalPolicy, SecretValue, Stack, StackProps } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { ManaSyncConfig } from './config';
import { reconhecer } from './nag';

interface EdgeStackProps extends StackProps {
  readonly config: ManaSyncConfig;
}

/** Porta do backend na task (backend/src/app.js, PORT). */
export const PORTA_BACKEND = 3001;

/**
 * Nome fixo do bucket de imagens (único no mundo pelo sufixo conta + região).
 *
 * Fixo para a permissão da task ser um ARN literal (`.../uploads/*`), estável e
 * reconhecível pelo cdk-nag sem depender do hash de um export entre stacks. Nome
 * fixo impede substituição pelo CloudFormation — o que este bucket, `RETAIN`, não
 * pode sofrer de qualquer forma.
 */
export const nomeBucketImagens = (conta: string, regiao: string) => `manasync-imagens-${conta}-${regiao}`;

/**
 * Rotas profundas da SPA: `/event/123` não existe no bucket, quem resolve é o
 * roteador do Angular. URI sem extensão vira `/index.html`; arquivo com extensão
 * que não existe continua 404.
 *
 * É uma CloudFront Function no comportamento **padrão** — e não `errorResponses`
 * na distribuição, que valem para todos os comportamentos: com elas, um 404 ou
 * 403 da API chegava ao navegador como 200 + HTML.
 */
const CODIGO_REESCRITA_SPA = `
function handler(event) {
  var request = event.request;
  var ultimo = request.uri.substring(request.uri.lastIndexOf('/') + 1);
  if (ultimo.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
`;

/**
 * A borda: TLS, domínio, a SPA e as imagens.
 *
 * Não referencia a stack da aplicação: a origem da API é o **nome**
 * `origin.<domínio>`, mantido pela Lambda de DNS. Sem esse corte, CloudFront e
 * ECS dependeriam um do outro e o CloudFormation recusaria o ciclo.
 */
export class EdgeStack extends Stack {
  readonly bucketSpa: s3.Bucket;
  readonly bucketImagens: s3.Bucket;
  readonly distribuicao: cloudfront.Distribution;
  /** JSON `{ atual, anterior }` — ver rotação em PLANO-DEPLOY.md §4.2.3. */
  readonly segredoOrigem: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const { config } = props;

    // A zona delegada é o próprio `app.mercadiastore.online` (D11 = B).
    const zona = route53.HostedZone.fromHostedZoneAttributes(this, 'Zona', {
      hostedZoneId: config.hostedZoneId,
      zoneName: config.domainName,
    });

    // Emitido fora do CDK, em us-east-1 (scripts/certificado.sh): nesta conta o
    // CDK não pode criar recurso lá (PLANO-DEPLOY.md §1.2).
    const certificado = acm.Certificate.fromCertificateArn(this, 'Certificado', config.certificateArn);

    /**
     * O segredo que prova que a requisição veio da **nossa** distribuição.
     *
     * O template guarda só a referência `{{resolve:secretsmanager:...}}`; o valor
     * aparece na configuração da distribuição, o que é inerente a header de origem.
     * `anterior` começa vazio e só é preenchido durante uma rotação.
     */
    this.segredoOrigem = new secretsmanager.Secret(this, 'SegredoOrigem', {
      description: 'ManaSync: header x-origin-verify que autentica o CloudFront na origem',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ anterior: '' }),
        generateStringKey: 'atual',
        passwordLength: 48,
        excludePunctuation: true,
      },
    });

    this.bucketSpa = new s3.Bucket(this, 'Spa', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // O bundle é reconstruível a partir do git.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.bucketImagens = new s3.Bucket(this, 'Imagens', {
      bucketName: nomeBucketImagens(config.conta, config.regiao),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Conteúdo enviado por gente: versionar custa centavos e devolve o apagado por engano.
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(90) }],
    });

    const seguranca = (extra: Partial<cloudfront.ResponseSecurityHeadersBehavior> = {}) => ({
      contentTypeOptions: { override: true },
      frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
      referrerPolicy: {
        referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
        override: true,
      },
      strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
      ...extra,
    });

    const cabecalhos = new cloudfront.ResponseHeadersPolicy(this, 'Cabecalhos', {
      comment: 'ManaSync: SPA e API',
      securityHeadersBehavior: seguranca(),
    });

    // Imagens enviadas por terceiros: mesmo que algo escape da validação por
    // assinatura, o navegador não executa nada servido deste caminho.
    const cabecalhosUploads = new cloudfront.ResponseHeadersPolicy(this, 'CabecalhosUploads', {
      comment: 'ManaSync: uploads, sem execucao',
      securityHeadersBehavior: seguranca({
        contentSecurityPolicy: { contentSecurityPolicy: "default-src 'none'; sandbox", override: true },
      }),
    });

    const reescritaSpa = new cloudfront.Function(this, 'ReescritaSpa', {
      comment: 'ManaSync: rota sem extensao -> /index.html',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(CODIGO_REESCRITA_SPA),
    });

    // Na rotação, a versão explícita faz o CloudFormation perceber a troca (config.ts).
    const valorOrigem = config.versaoSegredoOrigem
      ? SecretValue.secretsManager(this.segredoOrigem.secretArn, { jsonField: 'atual', versionId: config.versaoSegredoOrigem })
      : this.segredoOrigem.secretValueFromJson('atual');

    const origemApi = new origins.HttpOrigin(config.originHost, {
      // A task escuta na 3001; o padrão do HttpOrigin é 80 (N15).
      httpPort: PORTA_BACKEND,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      // Sobrescreve um header de mesmo nome vindo do visitante (documentado).
      customHeaders: { 'x-origin-verify': valorOrigem.unsafeUnwrap() },
      // O SSE fica em silêncio entre mudanças; o backend manda heartbeat a cada 15s.
      readTimeout: Duration.seconds(60),
      keepaliveTimeout: Duration.seconds(60),
    });

    this.distribuicao = new cloudfront.Distribution(this, 'Distribuicao', {
      comment: `ManaSync ${config.env}`,
      domainNames: [config.domainName],
      certificate: certificado,
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // Classe completa: as bordas da América do Sul só existem nela.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,

      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucketSpa),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: cabecalhos,
        compress: true,
        functionAssociations: [{ function: reescritaSpa, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },

      additionalBehaviors: {
        '/api/*': {
          origin: origemApi,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          // Sem cache e repassando tudo: sem isto o Authorization não chega e a API responde 401.
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: cabecalhos,
          // Compressão na borda arrisca bufferizar o stream SSE (N19).
          compress: false,
        },
        '/uploads/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucketImagens),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: cabecalhosUploads,
          compress: true,
        },
      },
    });

    reconhecer(this.segredoOrigem, 'AwsSolutions-SMG4', 'Rotação manual em duas etapas (atual/anterior), coordenada com o deploy da App (PLANO §4.2.3).');
    reconhecer(this.bucketSpa, 'AwsSolutions-S1', 'Access logs de S3 cobram por requisição e armazenamento; fora do orçamento atual.');
    reconhecer(this.bucketImagens, 'AwsSolutions-S1', 'Access logs de S3 cobram por requisição e armazenamento; fora do orçamento atual.');
    reconhecer(this.distribuicao, 'AwsSolutions-CFR1', 'Sem restrição geográfica: plataforma aberta.');
    reconhecer(this.distribuicao, 'AwsSolutions-CFR2', 'WAF (~US$ 5/mês + regras) fora do escopo atual (PLANO §13); o backend tem rate limit próprio.');
    reconhecer(this.distribuicao, 'AwsSolutions-CFR3', 'Logs de acesso do CloudFront fora do orçamento atual.');
    reconhecer(this.distribuicao, 'AwsSolutions-CFR5',
      'Origem da API em HTTP: TLS até a task exigiria ALB (+US$ 22/mês). Compensado por SG só com a prefix list do CloudFront e header secreto conferido pelo backend (PLANO §4.2).');

    // Sem `www` (D11 = B): o site é a raiz da zona delegada.
    const alvo = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribuicao));
    new route53.ARecord(this, 'A', { zone: zona, target: alvo });
    new route53.AaaaRecord(this, 'Aaaa', { zone: zona, target: alvo });

    new CfnOutput(this, 'BucketSpa', { value: this.bucketSpa.bucketName });
    new CfnOutput(this, 'BucketImagens', { value: this.bucketImagens.bucketName });
    new CfnOutput(this, 'DistribuicaoId', { value: this.distribuicao.distributionId });
    new CfnOutput(this, 'SegredoOrigemArn', { value: this.segredoOrigem.secretArn });
  }
}
