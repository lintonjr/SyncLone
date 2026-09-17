const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ambiente, CONTEXTO_PRONTO } = require('./ajuda');

const ZONA_ID = '/hostedzone/ZNOVA123';
const NS_R53 = ['ns-1.awsdns-01.org', 'ns-2.awsdns-02.co.uk', 'ns-3.awsdns-03.com', 'ns-4.awsdns-04.net'];
const HOSTGATOR = 'dns3.hostgator.com.br';

const ARQUIVO_VALIDO = {
  zona: 'mercadiastore.online',
  registros: [
    { nome: 'mercadiastore.online', tipo: 'A', ttl: 300, valores: ['162.240.81.81'] },
    { nome: 'mercadiastore.online', tipo: 'MX', ttl: 300, valores: ['0 mercadiastore.online'] },
    { nome: 'www.mercadiastore.online', tipo: 'CNAME', ttl: 300, valores: ['mercadiastore.online'] },
  ],
};

/**
 * Respostas de DNS por servidor. `r53` e `hostgator`: mapa "TIPO nome" → linhas.
 * `publico`: o que o 8.8.8.8 responde para NS da zona.
 */
function regrasDig({ r53 = {}, hostgator = {}, publico = ['dns3.hostgator.com.br.', 'dns4.hostgator.com.br.'] }) {
  const regras = [];
  const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [servidor, mapa] of [[NS_R53[0], r53], [HOSTGATOR, hostgator]]) {
    for (const [chave, linhas] of Object.entries(mapa)) {
      const [tipo, nome] = chave.split(' ');
      regras.push({ ferramenta: 'dig', padrao: `^\\+norecurse \\+short ${tipo} ${escapar(nome)} @${escapar(servidor)}$`, stdout: linhas.map((l) => l + '\n').join('') });
    }
  }
  regras.push({ ferramenta: 'dig', padrao: '^\\+norecurse \\+short', stdout: '' });
  regras.push({ ferramenta: 'dig', padrao: '^\\+short NS mercadiastore\\.online @8\\.8\\.8\\.8$', stdout: publico.map((l) => l + '\n').join('') });
  return regras;
}

const RESPOSTAS_IGUAIS = {
  'A mercadiastore.online': ['162.240.81.81'],
  'MX mercadiastore.online': ['0 mercadiastore.online.'],
  'CNAME www.mercadiastore.online': ['mercadiastore.online.'],
};

function regrasAws({ zonaExiste = false } = {}) {
  return [
    { ferramenta: 'aws', padrao: '^route53 list-hosted-zones-by-name', stdout: zonaExiste ? `${ZONA_ID}\n` : '\n' },
    { ferramenta: 'aws', padrao: '^route53 create-hosted-zone', stdout: `${ZONA_ID}\n` },
    { ferramenta: 'aws', padrao: '^route53 change-resource-record-sets', stdout: '/change/C123\n' },
    { ferramenta: 'aws', padrao: '^route53 wait resource-record-sets-changed --id C123$', stdout: '' },
    { ferramenta: 'aws', padrao: '^route53 get-hosted-zone', stdout: NS_R53.join('\t') + '\n' },
  ];
}

function preparar(t, { arquivo = ARQUIVO_VALIDO, zonaExiste = false, r53 = RESPOSTAS_IGUAIS, hostgator = RESPOSTAS_IGUAIS, publico } = {}) {
  const contexto = { ...CONTEXTO_PRONTO, 'manasync:zoneName': 'mercadiastore.online' };
  const amb = ambiente(t, { regras: [...regrasAws({ zonaExiste }), ...regrasDig({ r53, hostgator, publico })], contexto });
  const caminho = path.join(amb.dir, 'registros.json');
  fs.writeFileSync(caminho, JSON.stringify(arquivo));
  amb.arquivo = caminho;
  return amb;
}

test('zona: cria a zona, importa os registros como UPSERT e libera a troca quando tudo confere', (t) => {
  const amb = preparar(t);
  const r = amb.rodar('zona.sh', ['--arquivo', amb.arquivo]);
  assert.equal(r.codigo, 0, r.erro + amb.resumo());

  assert.ok(amb.indice('aws', '^route53 create-hosted-zone --name mercadiastore\\.online') >= 0);
  const troca = amb.chamadas().find((c) => c.linha.startsWith('route53 change-resource-record-sets'));
  const lote = JSON.parse(troca.args[troca.args.indexOf('--change-batch') + 1]);
  assert.deepEqual(lote.Changes.map((c) => [c.Action, c.ResourceRecordSet.Type, c.ResourceRecordSet.Name]), [
    ['UPSERT', 'A', 'mercadiastore.online'],
    ['UPSERT', 'MX', 'mercadiastore.online'],
    ['UPSERT', 'CNAME', 'www.mercadiastore.online'],
  ]);
  assert.deepEqual(lote.Changes[0].ResourceRecordSet.ResourceRecords, [{ Value: '162.240.81.81' }]);

  assert.match(r.erro, /Registros conferidos/);
  for (const ns of NS_R53) assert.match(r.erro, new RegExp(ns.replace(/\./g, '\\.')));
  assert.match(r.erro, /Domínios → mercadiastore\.online → Servidores DNS/);

  const aplicar = amb.indice('aws', '^route53 change-resource-record-sets');
  const esperar = amb.indice('aws', '^route53 wait resource-record-sets-changed --id C123$');
  const comparar = amb.indice('dig', '^\\+norecurse');
  assert.ok(aplicar < esperar && esperar < comparar, 'a comparação só roda depois de a mudança ficar INSYNC\n' + amb.resumo());
});

test('zona: zona existente não é recriada; --gravar grava o ID', (t) => {
  const amb = preparar(t, { zonaExiste: true });
  const r = amb.rodar('zona.sh', ['--arquivo', amb.arquivo, '--gravar']);
  assert.equal(r.codigo, 0, r.erro);
  assert.equal(amb.indice('aws', '^route53 create-hosted-zone'), -1);
  const cdk = JSON.parse(fs.readFileSync(path.join(amb.dir, 'cdk.json'), 'utf8'));
  assert.equal(cdk.context['manasync:hostedZoneId'], 'ZNOVA123');
});

test('zona: registro diferente entre Route 53 e HostGator impede a troca', (t) => {
  const amb = preparar(t, { r53: { ...RESPOSTAS_IGUAIS, 'A mercadiastore.online': ['10.0.0.1'] } });
  const r = amb.rodar('zona.sh', ['--arquivo', amb.arquivo]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /DIFERENTE: A mercadiastore\.online/);
  assert.match(r.erro, /NÃO troque os servidores de nome ainda/);
  assert.doesNotMatch(r.erro, /Registros conferidos/);
});

test('zona: registro que não responde no Route 53 também é diferença', (t) => {
  const semMx = { ...RESPOSTAS_IGUAIS };
  delete semMx['MX mercadiastore.online'];
  const amb = preparar(t, { r53: semMx });
  assert.notEqual(amb.rodar('zona.sh', ['--arquivo', amb.arquivo]).codigo, 0);
});

test('zona: com a delegação ativa e tudo igual, confirma e sai limpo', (t) => {
  const amb = preparar(t, { zonaExiste: true, publico: NS_R53.map((n) => n + '.') });
  const r = amb.rodar('zona.sh', ['--arquivo', amb.arquivo]);
  assert.equal(r.codigo, 0, r.erro);
  assert.match(r.erro, /delegação ativa/);
  assert.doesNotMatch(r.erro, /troque os servidores/);
});

test('zona: depois da troca, diferença da HostGator é só aviso; registro sem resposta no Route 53 é erro', (t) => {
  const publico = NS_R53.map((n) => n + '.');
  const novoSpf = preparar(t, { zonaExiste: true, publico, hostgator: { ...RESPOSTAS_IGUAIS, 'A mercadiastore.online': [] } });
  const r = novoSpf.rodar('zona.sh', ['--arquivo', novoSpf.arquivo]);
  assert.equal(r.codigo, 0, r.erro);
  assert.match(r.erro, /1 registro\(s\) diferem da cópia antiga/);

  const semMx = { ...RESPOSTAS_IGUAIS };
  delete semMx['MX mercadiastore.online'];
  const quebrado = preparar(t, { zonaExiste: true, publico, r53: semMx });
  const r2 = quebrado.rodar('zona.sh', ['--arquivo', quebrado.arquivo]);
  assert.notEqual(r2.codigo, 0);
  assert.match(r2.erro, /1 registro\(s\) não respondem no Route 53/);
});

for (const [caso, registros, esperado] of [
  ['NS na lista', [{ nome: 'mercadiastore.online', tipo: 'NS', ttl: 300, valores: ['dns3.hostgator.com.br'] }], /tipo NS não permitido/],
  ['nome fora da zona', [{ nome: 'exemplo.com', tipo: 'A', ttl: 300, valores: ['1.1.1.1'] }], /fora da zona/],
  ['registro do site (CDK)', [{ nome: 'app.mercadiastore.online', tipo: 'A', ttl: 300, valores: ['1.1.1.1'] }], /é do CDK/],
  ['origem do site (Lambda)', [{ nome: 'origin.app.mercadiastore.online', tipo: 'A', ttl: 300, valores: ['1.1.1.1'] }], /é do CDK/],
  ['sufixo parecido mas outra zona', [{ nome: 'xmercadiastore.online', tipo: 'A', ttl: 300, valores: ['1.1.1.1'] }], /fora da zona/],
]) {
  test(`zona: arquivo com ${caso} é recusado antes de qualquer chamada à AWS`, (t) => {
    const amb = preparar(t, { arquivo: { zona: 'mercadiastore.online', registros } });
    const r = amb.rodar('zona.sh', ['--arquivo', amb.arquivo]);
    assert.notEqual(r.codigo, 0);
    assert.match(r.erro, esperado);
    assert.equal(amb.indice('aws', '^route53'), -1, amb.resumo());
  });
}

test('zona: o arquivo real do repositório é válido e não contém registros do site', (t) => {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'infra', 'dns', 'registros-hostgator.json'), 'utf8'));
  const amb = preparar(t, { arquivo: real, r53: {}, hostgator: {} });
  const r = amb.rodar('zona.sh', ['--arquivo', amb.arquivo]);
  assert.match(r.erro, /arquivo de registros válido \(5 registros\)/);
  assert.ok(real.registros.every((x) => !/(^|\.)app\.mercadiastore\.online$/.test(x.nome)));
});
