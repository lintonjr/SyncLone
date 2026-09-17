const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPTS = path.join(__dirname, '..');
const RAIZ = path.join(SCRIPTS, '..');

/** Conta fictícia (padrão dos exemplos da AWS). A real fica no .env, fora do git. */
const CONTA_TESTE = '111122223333';

/** cdk.json preenchido como estaria no dia do deploy. */
const CONTEXTO_PRONTO = {
  'manasync:region': 'us-east-2',
  'manasync:domainName': 'app.mercadiastore.online',
  'manasync:zoneName': 'mercadiastore.online',
  'manasync:hostedZoneId': 'Z0TESTE00000000',
  'manasync:certificateArn': `arn:aws:acm:us-east-1:${CONTA_TESTE}:certificate/abc`,
};

/** Regras que quase todo teste precisa: identidade certa e buildx com arm64. */
const REGRAS_BASE = [
  { ferramenta: 'aws', padrao: '^sts get-caller-identity', stdout: `${CONTA_TESTE}\n` },
  { ferramenta: 'docker', padrao: '^buildx ls', stdout: 'default  docker  running  linux/amd64, linux/arm64\n' },
];

/**
 * Um ambiente isolado: stubs no lugar das ferramentas, cdk.json e .env próprios.
 * `regras` vêm antes das base, então um teste pode sobrescrever qualquer resposta.
 */
function ambiente(t, { regras = [], contexto = CONTEXTO_PRONTO, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manasync-scripts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(dir, 'regras.json'), JSON.stringify([...regras, ...REGRAS_BASE]));
  fs.writeFileSync(path.join(dir, 'chamadas.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'cdk.json'), JSON.stringify({ app: 'x', context: contexto }));
  fs.writeFileSync(path.join(dir, '.env'), `ADMIN_EMAIL=dono@exemplo.com\nMANASYNC_CONTA=${CONTA_TESTE}\n`);

  const envStubs = {};
  for (const ferramenta of ['aws', 'cdk', 'docker', 'npm', 'dig', 'migrar', 'publicar']) {
    const wrapper = path.join(dir, `stub-${ferramenta}`);
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec node "${path.join(__dirname, 'stub.js')}" ${ferramenta} "$@"\n`, { mode: 0o755 });
    envStubs[ferramenta] = wrapper;
  }

  const variaveis = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    STUB_DIR: dir,
    MANASYNC_AWS: envStubs.aws,
    MANASYNC_CDK: envStubs.cdk,
    MANASYNC_DOCKER: envStubs.docker,
    MANASYNC_NPM: envStubs.npm,
    MANASYNC_DIG: envStubs.dig,
    MANASYNC_MIGRAR: envStubs.migrar,
    MANASYNC_PUBLICAR: envStubs.publicar,
    MANASYNC_CDK_JSON: path.join(dir, 'cdk.json'),
    MANASYNC_ENV_FILE: path.join(dir, '.env'),
    MANASYNC_SIM: '1',
    MANASYNC_ESPERA_S: '0',
    ...env,
  };

  return {
    dir,
    rodar(script, args = []) {
      const r = spawnSync('bash', [path.join(SCRIPTS, script), ...args], {
        env: variaveis,
        encoding: 'utf8',
        timeout: 60000,
      });
      return { codigo: r.status, saida: r.stdout, erro: r.stderr };
    },
    /**
     * Versão assíncrona: necessária quando o próprio teste atende requisições do
     * script (servidor HTTP local). Com spawnSync o processo do teste fica
     * bloqueado e o servidor nunca responde.
     */
    rodarAsync(script, args = []) {
      return new Promise((resolve) => {
        const filho = spawn('bash', [path.join(SCRIPTS, script), ...args], { env: variaveis });
        let saida = '';
        let erro = '';
        filho.stdout.on('data', (d) => { saida += d; });
        filho.stderr.on('data', (d) => { erro += d; });
        const prazo = setTimeout(() => filho.kill('SIGKILL'), 60000);
        filho.on('close', (codigo) => { clearTimeout(prazo); resolve({ codigo, saida, erro }); });
      });
    },
    chamadas() {
      return fs
        .readFileSync(path.join(dir, 'chamadas.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    },
    /** Índice da primeira chamada que casa (ferramenta + regex), ou -1. */
    indice(ferramenta, padrao) {
      return this.chamadas().findIndex((c) => c.ferramenta === ferramenta && new RegExp(padrao).test(c.linha));
    },
    /** Linhas das chamadas, `ferramenta args`, para mensagens de erro legíveis. */
    resumo() {
      return this.chamadas().map((c) => `${c.ferramenta} ${c.linha}`).join('\n');
    },
  };
}

/** Outputs das stacks, como o `describe-stacks --query ... --output text` devolve. */
const saida = (stack, chave, valor) => ({
  ferramenta: 'aws',
  padrao: `^cloudformation describe-stacks --stack-name ${stack} --query .*OutputKey=='${chave}'`,
  stdout: `${valor}\n`,
});

module.exports = { ambiente, saida, CONTEXTO_PRONTO, CONTA_TESTE, RAIZ };
