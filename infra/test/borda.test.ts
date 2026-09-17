import { test } from 'node:test';
import assert from 'node:assert';
import { json, montarTeste, unico } from './ajuda';

const { tpl } = montarTeste();
const borda = tpl.borda;
const dist = unico(borda, 'AWS::CloudFront::Distribution').Properties.DistributionConfig;
const CACHE_DESLIGADO = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';

const comportamento = (padrao: string) => dist.CacheBehaviors.find((b: any) => b.PathPattern === padrao);
const origemDe = (b: any) => dist.Origins.find((o: any) => o.Id === b.TargetOriginId);

test('borda: origem da API na porta 3001, HTTP, com o header de origem (N15)', () => {
  const origem = origemDe(comportamento('/api/*'));
  assert.equal(origem.DomainName, 'origin.app.mercadiastore.online');
  assert.equal(origem.CustomOriginConfig.HTTPPort, 3001, 'o padrão 80 não chega ao backend');
  assert.equal(origem.CustomOriginConfig.OriginProtocolPolicy, 'http-only');
  const header = origem.OriginCustomHeaders.find((h: any) => h.HeaderName === 'x-origin-verify');
  assert.ok(header, 'sem o header, o backend responde 403 a tudo');
  assert.match(json(header.HeaderValue), /resolve:secretsmanager.*:SecretString:atual/);
});

test('borda: /api/* sem cache e sem compressão (SSE, N19)', () => {
  const api = comportamento('/api/*');
  assert.equal(api.Compress, false);
  assert.equal(api.CachePolicyId, CACHE_DESLIGADO);
  assert.deepEqual(api.AllowedMethods.sort(), ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
});

test('borda: sem errorResponses — erro da API não vira 200 + HTML (h)', () => {
  assert.equal(dist.CustomErrorResponses, undefined);
});

test('borda: rotas da SPA reescritas por CloudFront Function só no comportamento padrão', () => {
  const fn = unico(borda, 'AWS::CloudFront::Function');
  assert.match(fn.Properties.FunctionCode, /request\.uri = '\/index\.html'/);
  assert.equal(dist.DefaultCacheBehavior.FunctionAssociations.length, 1);
  assert.equal(dist.DefaultCacheBehavior.FunctionAssociations[0].EventType, 'viewer-request');
  for (const b of dist.CacheBehaviors) assert.equal(b.FunctionAssociations, undefined, b.PathPattern);
});

test('borda: a função de reescrita trata rota sem extensão e preserva arquivos', () => {
  const codigo = unico(borda, 'AWS::CloudFront::Function').Properties.FunctionCode;
  const handler = new Function(`${codigo}; return handler;`)();
  const uri = (u: string) => handler({ request: { uri: u } }).uri;
  assert.equal(uri('/event/123'), '/index.html');
  assert.equal(uri('/'), '/index.html');
  assert.equal(uri('/main-ABC123.js'), '/main-ABC123.js');
  assert.equal(uri('/assets/logo.svg'), '/assets/logo.svg');
});

test('borda: só o domínio app, sem www (D11 = B), TLS 1.2+', () => {
  assert.deepEqual(dist.Aliases, ['app.mercadiastore.online']);
  assert.equal(dist.ViewerCertificate.MinimumProtocolVersion, 'TLSv1.2_2021');
  assert.match(dist.ViewerCertificate.AcmCertificateArn, /^arn:aws:acm:us-east-1:111122223333:/);
  const registros = Object.values(borda.findResources('AWS::Route53::RecordSet')).map((r: any) => r.Properties);
  assert.deepEqual(registros.map((r: any) => r.Type).sort(), ['A', 'AAAA']);
  assert.ok(registros.every((r: any) => r.Name === 'app.mercadiastore.online.'));
});

test('borda: uploads com CSP que impede execução', () => {
  const uploads = comportamento('/uploads/*');
  const politicas = borda.findResources('AWS::CloudFront::ResponseHeadersPolicy');
  const [, politica] = Object.entries(politicas).find(([id]) => json(uploads.ResponseHeadersPolicyId).includes(id))!;
  const seguranca = (politica as any).Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
  assert.equal(seguranca.ContentSecurityPolicy.ContentSecurityPolicy, "default-src 'none'; sandbox");
  assert.equal(seguranca.ContentTypeOptions.Override, true);
});

test('borda: buckets privados, com SSL obrigatório; imagens versionadas e retidas', () => {
  const buckets = borda.findResources('AWS::S3::Bucket');
  for (const [id, b] of Object.entries(buckets) as any) {
    assert.deepEqual(b.Properties.PublicAccessBlockConfiguration, {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    }, id);
    const politica: any = Object.values(borda.findResources('AWS::S3::BucketPolicy')).find((p: any) => json(p.Properties.Bucket).includes(id));
    assert.match(json(politica), /aws:SecureTransport/, `${id} sem enforceSSL`);
  }
  const imagens = unico(borda, 'AWS::S3::Bucket', (p) => p.BucketName === 'manasync-imagens-111122223333-us-east-2');
  assert.equal(imagens.Properties.VersioningConfiguration.Status, 'Enabled');
  assert.equal(imagens.DeletionPolicy, 'Retain');
});

test('borda: nenhum bucket acessível sem OAC (sem site público do S3)', () => {
  for (const b of Object.values(borda.findResources('AWS::S3::Bucket')) as any) {
    assert.equal(b.Properties.WebsiteConfiguration, undefined);
  }
  assert.ok(dist.Origins.filter((o: any) => o.S3OriginConfig).every((o: any) => o.OriginAccessControlId));
});

test('borda: rotação — versão explícita do segredo muda a referência do header (senão o CloudFront não atualiza)', () => {
  const VERSAO = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const rot = montarTeste({ 'manasync:versaoSegredoOrigem': VERSAO });
  const d = unico(rot.tpl.borda, 'AWS::CloudFront::Distribution').Properties.DistributionConfig;
  const origem = d.Origins.find((o: any) => o.CustomOriginConfig);
  const header = origem.OriginCustomHeaders.find((h: any) => h.HeaderName === 'x-origin-verify');
  assert.match(json(header.HeaderValue), new RegExp(`:SecretString:atual::${VERSAO}`));

  const semVersao = origemDe(comportamento('/api/*')).OriginCustomHeaders.find((h: any) => h.HeaderName === 'x-origin-verify');
  assert.notEqual(json(header.HeaderValue), json(semVersao.HeaderValue), 'o texto precisa mudar para o CloudFormation agir');
});
