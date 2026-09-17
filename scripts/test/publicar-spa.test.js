const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ambiente, saida } = require('./ajuda');

const REGRAS = [
  saida('ManaSyncBorda', 'BucketSpa', 'manasyncborda-spa-xyz'),
  saida('ManaSyncBorda', 'DistribuicaoId', 'E123ABC'),
  { ferramenta: 'aws', padrao: '^s3 (sync|cp)' },
  { ferramenta: 'aws', padrao: '^cloudfront create-invalidation', stdout: '{}' },
  { ferramenta: 'npm', padrao: '^(ci|run build)$' },
];

function comDist(t, { comIndex = true } = {}) {
  const amb0 = ambiente(t, { regras: REGRAS });
  const dist = path.join(amb0.dir, 'dist');
  fs.mkdirSync(dist);
  if (comIndex) fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(dist, 'main-ABCD1234.js'), '');
  return ambiente(t, { regras: REGRAS, env: { MANASYNC_DIST_SPA: dist } });
}

test('publicar: cache certo para cada tipo de arquivo, index.html por último, depois invalida', (t) => {
  const amb = comDist(t);
  const r = amb.rodar('publicar-spa.sh', ['--sem-build']);
  assert.equal(r.codigo, 0, r.erro + amb.resumo());

  const aws = amb.chamadas().filter((c) => c.ferramenta === 'aws' && !c.linha.startsWith('cloudformation') && !c.linha.startsWith('sts'));
  assert.equal(aws.length, 4, amb.resumo());
  const [resto, hash, index, invalidacao] = aws.map((c) => c.linha);

  assert.match(resto, /^s3 sync .* s3:\/\/manasyncborda-spa-xyz --delete/);
  assert.match(resto, /--exclude index\.html/);
  assert.match(resto, /--exclude \*-\?\?\?\?\?\?\?\?\.js/);
  assert.match(resto, /--cache-control public, max-age=300/);

  assert.match(hash, /--exclude \* --include \*-\?\?\?\?\?\?\?\?\.js/);
  assert.match(hash, /max-age=31536000, immutable/);
  assert.doesNotMatch(hash, /--delete/);

  assert.match(index, /^s3 cp .*index\.html s3:\/\/manasyncborda-spa-xyz\/index\.html/);
  assert.match(index, /--cache-control no-cache/);

  assert.match(invalidacao, /^cloudfront create-invalidation --distribution-id E123ABC --paths \/index\.html \//);
});

test('publicar: com build, roda npm ci e build antes de publicar', (t) => {
  const amb = comDist(t);
  const r = amb.rodar('publicar-spa.sh');
  assert.equal(r.codigo, 0, r.erro);
  const build = amb.indice('npm', '^run build$');
  const ci = amb.indice('npm', '^ci$');
  const sync = amb.indice('aws', '^s3 sync');
  assert.ok(ci >= 0 && ci < build && build < sync, amb.resumo());
});

test('publicar: sem index.html no build, não publica nada', (t) => {
  const amb = comDist(t, { comIndex: false });
  const r = amb.rodar('publicar-spa.sh', ['--sem-build']);
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /index\.html não existe/);
  assert.equal(amb.indice('aws', '^s3'), -1);
});

test('publicar: build que falha para antes do S3', (t) => {
  const amb = ambiente(t, { regras: [{ ferramenta: 'npm', padrao: '^run build$', codigo: 1 }, ...REGRAS] });
  const r = amb.rodar('publicar-spa.sh');
  assert.notEqual(r.codigo, 0);
  assert.equal(amb.indice('aws', '^s3'), -1);
});
