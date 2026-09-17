const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ambiente, CONTA_TESTE } = require('./ajuda');

test('aws-env: conta, perfil e dono certos passam', (t) => {
  const amb = ambiente(t);
  const r = amb.rodar('aws-env.sh');
  assert.equal(r.codigo, 0, r.erro);
  assert.match(r.erro, /conta do projeto conferida, perfil manasync, região us-east-2/);
  assert.match(r.erro, /dono dono@exemplo\.com/);
});

test('aws-env: credenciais de outra conta abortam', (t) => {
  const amb = ambiente(t, { regras: [{ ferramenta: 'aws', padrao: '^sts', stdout: '444455556666\n' }] });
  const r = amb.rodar('aws-env.sh');
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /conta 444455556666, não da conta do projeto/);
});

test('aws-env: login expirado orienta o aws login', (t) => {
  const amb = ambiente(t, {
    regras: [{ ferramenta: 'aws', padrao: '^sts', stderr: 'The provided authorization grant is invalid, expired', codigo: 254 }],
  });
  const r = amb.rodar('aws-env.sh');
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /aws login --profile manasync/);
});

test('aws-env: outro AWS_PROFILE exportado é recusado, não trocado em silêncio', (t) => {
  const amb = ambiente(t, { env: { AWS_PROFILE: 'default' } });
  const r = amb.rodar('aws-env.sh');
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /AWS_PROFILE=default/);
  assert.equal(amb.indice('aws', '^sts'), -1, 'nem chegou a chamar a AWS');
});

test('aws-env: Docker sem emulação arm64 aborta (a não ser quando o script não constrói imagem)', (t) => {
  const amb = ambiente(t, { regras: [{ ferramenta: 'docker', padrao: '^buildx ls', stdout: 'default docker linux/amd64\n' }] });
  const r = amb.rodar('aws-env.sh');
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /emulação arm64/);

  const semDocker = ambiente(t, {
    regras: [{ ferramenta: 'docker', padrao: '^buildx ls', stdout: 'linux/amd64\n' }],
    env: { MANASYNC_PULAR_DOCKER: '1' },
  });
  assert.equal(semDocker.rodar('aws-env.sh').codigo, 0);
});

test('aws-env: e-mail do dono no domínio do site é recusado (N1)', (t) => {
  for (const email of ['admin@mercadiastore.online', 'x@app.mercadiastore.online']) {
    const amb = ambiente(t, { env: { ADMIN_EMAIL: email } });
    const r = amb.rodar('aws-env.sh');
    assert.notEqual(r.codigo, 0, email);
    assert.match(r.erro, /não pode ser do domínio/);
  }
});

test('aws-env: sem ADMIN_EMAIL no .env, aborta', (t) => {
  const amb = ambiente(t);
  fs.writeFileSync(path.join(amb.dir, '.env'), `# sem ADMIN_EMAIL\nMANASYNC_CONTA=${CONTA_TESTE}\n`);
  const r = amb.rodar('aws-env.sh');
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /ADMIN_EMAIL não definido/);
});

test('aws-env: lê ADMIN_EMAIL do .env sem executar o arquivo', (t) => {
  const amb = ambiente(t);
  const marcador = path.join(amb.dir, 'executou');
  fs.writeFileSync(path.join(amb.dir, '.env'), `ADMIN_EMAIL="dono@exemplo.com"\nMANASYNC_CONTA=${CONTA_TESTE}\ntouch ${marcador}\n`);
  const r = amb.rodar('aws-env.sh');
  assert.equal(r.codigo, 0, r.erro);
  assert.equal(fs.existsSync(marcador), false, 'o .env não pode ser executado como script');
});

test('aws-env: sem MANASYNC_CONTA no .env, aborta antes de chamar a AWS', (t) => {
  const amb = ambiente(t);
  fs.writeFileSync(path.join(amb.dir, '.env'), 'ADMIN_EMAIL=dono@exemplo.com\n');
  const r = amb.rodar('aws-env.sh');
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /MANASYNC_CONTA não definida/);
  assert.equal(amb.indice('aws', '^sts'), -1);
});

test('aws-env: MANASYNC_CONTA malformada é recusada', (t) => {
  const amb = ambiente(t);
  fs.writeFileSync(path.join(amb.dir, '.env'), 'ADMIN_EMAIL=dono@exemplo.com\nMANASYNC_CONTA=7608-5263\n');
  assert.notEqual(amb.rodar('aws-env.sh').codigo, 0);
});

test('aws-env: a mensagem de sucesso não imprime o ID da conta (logs de CI e prints de tela)', (t) => {
  const amb = ambiente(t);
  const r = amb.rodar('aws-env.sh');
  assert.equal(r.codigo, 0, r.erro);
  assert.ok(!r.erro.includes(CONTA_TESTE));
});
