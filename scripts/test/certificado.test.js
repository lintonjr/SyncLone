const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ambiente, CONTA_TESTE } = require('./ajuda');

const NS_R53 = ['ns-1.awsdns-01.org', 'ns-2.awsdns-02.co.uk', 'ns-3.awsdns-03.com', 'ns-4.awsdns-04.net'];
const ARN = `arn:aws:acm:us-east-1:${CONTA_TESTE}:certificate/novo`;

function regras(nsPublicos) {
  return [
    { ferramenta: 'aws', padrao: '^route53 get-hosted-zone --id Z0TESTE00000000', stdout: NS_R53.join('\t') + '\n' },
    { ferramenta: 'dig', padrao: '^\\+short NS mercadiastore\\.online @8\\.8\\.8\\.8$', stdout: nsPublicos.map((n) => n + '.\n').join('') },
    { ferramenta: 'aws', padrao: '^acm list-certificates', stdout: 'None\n' },
    { ferramenta: 'aws', padrao: '^acm request-certificate', stdout: `${ARN}\n` },
    { ferramenta: 'aws', padrao: '^acm describe-certificate', stdout: '_abc.app.mercadiastore.online.\t_xyz.acm-validations.aws.\n' },
    { ferramenta: 'aws', padrao: '^route53 change-resource-record-sets', stdout: '{}' },
    { ferramenta: 'aws', padrao: '^acm wait', stdout: '' },
  ];
}

test('certificado: antes da troca dos servidores de nome (HostGator ainda responde), para sem pedir certificado', (t) => {
  const amb = ambiente(t, { regras: regras(['dns3.hostgator.com.br', 'dns4.hostgator.com.br']) });
  const r = amb.rodar('certificado.sh');
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /ainda não aponta para o Route 53 \(hoje: dns3\.hostgator\.com\.br dns4\.hostgator\.com\.br \)/);
  assert.equal(amb.indice('aws', '^acm'), -1, amb.resumo());
});

test('certificado: delegação parcial (propagando) também para', (t) => {
  const amb = ambiente(t, { regras: regras(NS_R53.slice(0, 2)) });
  assert.notEqual(amb.rodar('certificado.sh').codigo, 0);
  assert.equal(amb.indice('aws', '^acm'), -1);
});

test('certificado: com a delegação ativa, emite para o site, valida na zona e grava o ARN', (t) => {
  const amb = ambiente(t, {
    regras: regras([...NS_R53].reverse()),
    contexto: {
      'manasync:region': 'us-east-2',
      'manasync:domainName': 'app.mercadiastore.online',
      'manasync:zoneName': 'mercadiastore.online',
      'manasync:hostedZoneId': 'Z0TESTE00000000',
      'manasync:certificateArn': 'TROCAR_depois_de_scripts/certificado.sh',
    },
    contextoLocal: null,
  });
  const r = amb.rodar('certificado.sh', ['--gravar']);
  assert.equal(r.codigo, 0, r.erro + amb.resumo());
  assert.ok(amb.indice('aws', '^acm request-certificate --region us-east-1 --domain-name app\\.mercadiastore\\.online ') >= 0, amb.resumo());
  assert.ok(amb.indice('aws', '^route53 change-resource-record-sets --hosted-zone-id Z0TESTE00000000') >= 0);
  // O ARN leva o ID da conta: vai para o cdk.context.json (fora do git), nunca para o cdk.json.
  const local = JSON.parse(fs.readFileSync(path.join(amb.dir, 'cdk.context.json'), 'utf8'));
  assert.equal(local['manasync:certificateArn'], ARN);
  const cdkJson = fs.readFileSync(path.join(amb.dir, 'cdk.json'), 'utf8');
  assert.ok(!cdkJson.includes(CONTA_TESTE), cdkJson);
  // O TROCAR no cdk.json esconderia o ARN (o CDK lê o cdk.json primeiro): sai de lá.
  assert.equal(JSON.parse(cdkJson).context['manasync:certificateArn'], undefined);
});
