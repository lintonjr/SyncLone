const fs = require('fs');

/**
 * Leitura do ambiente, num lugar só.
 *
 * Três coisas que eram literais no código passaram a depender de onde o
 * processo roda: quem pode chamar a API de outra origem, quantos proxies estão
 * na frente dele e se a conexão com o banco é cifrada. Nenhuma delas pode
 * continuar escrita à mão — a mesma imagem sobe no Docker local e no ECS.
 *
 * São funções puras que recebem `env` em vez de lerem `process.env` por dentro:
 * é o que permite testá-las sem montar ambiente e sem subir servidor.
 */

/** Padrão de desenvolvimento: o `ng serve` e a porta alternativa. */
const ORIGENS_DEV = ['http://localhost:4200', 'http://localhost:4201'];

/**
 * Quem pode chamar a API de outra origem.
 *
 * Em produção a lista tende a ficar **vazia**, e isso é o desenho certo, não um
 * esquecimento: com o SPA e a API atrás do mesmo domínio (CloudFront roteando
 * `/api/*` para cá), toda chamada é same-origin e o navegador nem faz preflight.
 * CORS existe aqui para o desenvolvimento, onde o `ng serve` vive numa porta e a
 * API em outra.
 *
 * `*` é aceito explicitamente para quem quiser abrir a API de propósito, mas
 * nunca é o padrão: o padrão silencioso de um sistema com JWT no header não pode
 * ser "qualquer site pode me chamar".
 *
 * Variável vazia só cai no par de desenvolvimento **fora** de produção. Em
 * produção, vazio quer dizer nenhuma origem (`false`, o `cors` não emite
 * cabeçalho algum): antes, o mesmo vazio que o CDK manda de propósito liberava
 * `localhost:4200` com credenciais no site publicado.
 */
function corsOrigins(env = process.env) {
  const bruto = env.CORS_ORIGINS?.trim();
  if (bruto === undefined || bruto === '') {
    return env.NODE_ENV === 'production' ? false : ORIGENS_DEV;
  }
  if (bruto === '*') return '*';
  return bruto.split(',').map((o) => o.trim()).filter(Boolean);
}

/**
 * Quantos proxies confiáveis estão na frente do processo.
 *
 * Isto não é detalhe de configuração: o limitador de tentativas de senha chaveia
 * no IP do cliente, e o IP do cliente é o que o Express extrai do
 * `X-Forwarded-For` contando saltos a partir do fim. Errar o número troca o IP
 * de quem chama pelo do proxy — e aí o limite de 10 tentativas passa a ser
 * compartilhado por todo mundo, ou, pior, passa a poder ser forjado.
 *
 * Um salto em produção (só o CloudFront) e um no Docker local (só o nginx), daí
 * o padrão 1. Se um dia entrar um ALB entre o CloudFront e este processo, são
 * dois — e é por isso que o número vem do ambiente e não do código.
 */
function trustProxy(env = process.env) {
  const bruto = env.TRUST_PROXY?.trim();
  if (!bruto) return 1;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`TRUST_PROXY precisa ser um inteiro >= 0 (veio "${bruto}")`);
  }
  return n;
}

/**
 * Configuração TLS da conexão com o MySQL.
 *
 * Desligada por padrão porque o MySQL do Docker local não fala TLS. Ligada, ela
 * **exige** o certificado da autoridade: as CAs da RDS não estão no armazenamento
 * de confiança do sistema, então sem o bundle não há como verificar o servidor —
 * e verificar é o ponto. `rejectUnauthorized: false` cifraria o tráfego e
 * continuaria aceitando qualquer servidor que se dissesse o banco, o que é
 * cerimônia, não segurança.
 *
 * Falta o arquivo? O processo não sobe. É de propósito: um backend que aceita
 * subir sem a configuração de segurança que pediram é um backend que vai rodar
 * meses sem ela sem ninguém perceber. O erro na inicialização aparece no primeiro
 * deploy; um downgrade silencioso não aparece nunca.
 */
function dbSsl(env = process.env, lerArquivo = fs.readFileSync) {
  if (env.DB_SSL?.trim() !== 'true') return undefined;

  const caminho = env.DB_SSL_CA_PATH?.trim();
  if (!caminho) {
    throw new Error('DB_SSL=true exige DB_SSL_CA_PATH apontando para o bundle da CA (RDS: global-bundle.pem)');
  }

  let ca;
  try {
    ca = lerArquivo(caminho, 'utf8');
  } catch (err) {
    throw new Error(`DB_SSL_CA_PATH aponta para "${caminho}", que não pôde ser lido: ${err.message}`);
  }

  return { ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' };
}

/**
 * Intervalo do heartbeat do SSE.
 *
 * O stream fica em silêncio entre uma mudança e outra, e todo intermediário
 * trata silêncio como conexão morta. O CloudFront derruba a origem após 30s sem
 * pacote; o valor antigo, 25s, deixava 5 segundos de margem para uma conexão que
 * precisa durar a noite inteira de torneio. 15s dá o dobro de folga pelo custo de
 * dois bytes a cada quinze segundos.
 */
function sseHeartbeatMs(env = process.env) {
  const n = Number(env.SSE_HEARTBEAT_MS?.trim() || 15000);
  if (!Number.isInteger(n) || n < 1000) {
    throw new Error(`SSE_HEARTBEAT_MS precisa ser um inteiro >= 1000 (veio "${env.SSE_HEARTBEAT_MS}")`);
  }
  return n;
}

/** Abaixo disto um segredo HMAC é adivinhável por força bruta offline. */
const TAMANHO_MINIMO_SEGREDO = 32;

/**
 * O segredo que assina os tokens de sessão.
 *
 * Sem ele o `jwt.sign` falha na hora do login, com um erro 500 genérico: o
 * servidor sobe, o health check passa e ninguém consegue entrar. Validar na
 * subida troca esse defeito silencioso por um processo que não inicia.
 *
 * O tamanho mínimo só é exigido em produção. Fora dela o segredo é de
 * brinquedo por definição, e barrar o `npm run dev` de quem tem um `.env` antigo
 * não protege nada.
 */
function jwtSecret(env = process.env) {
  const valor = env.JWT_SECRET;
  if (!valor?.trim()) {
    throw new Error('JWT_SECRET não definido: sem ele nenhum token pode ser assinado');
  }
  if (env.NODE_ENV === 'production' && valor.length < TAMANHO_MINIMO_SEGREDO) {
    throw new Error(`JWT_SECRET precisa de pelo menos ${TAMANHO_MINIMO_SEGREDO} caracteres em produção`);
  }
  return valor;
}

/**
 * Os valores aceitos no header que prova que a requisição passou pelo CloudFront.
 *
 * Dois porque trocar o segredo não pode derrubar o site: durante a rotação a
 * task aceita o novo (`ATUAL`) e o que a distribuição ainda envia (`ANTERIOR`).
 *
 * Lista vazia desliga a verificação — é o caso do Docker local, onde não há
 * CloudFront. A decisão é pela presença da variável, e não por `NODE_ENV`, porque
 * a imagem roda com `NODE_ENV=production` também no compose. Quem garante que a
 * task de produção recebe o segredo é o teste do CDK.
 */
function segredosOrigem(env = process.env) {
  const atual = env.ORIGIN_VERIFY_ATUAL?.trim();
  const anterior = env.ORIGIN_VERIFY_ANTERIOR?.trim();

  if (!atual) {
    if (anterior) {
      throw new Error('ORIGIN_VERIFY_ANTERIOR sem ORIGIN_VERIFY_ATUAL: a rotação ficou pela metade');
    }
    return [];
  }

  const segredos = anterior ? [atual, anterior] : [atual];
  for (const s of segredos) {
    if (s.length < TAMANHO_MINIMO_SEGREDO) {
      throw new Error(`ORIGIN_VERIFY_* precisa de pelo menos ${TAMANHO_MINIMO_SEGREDO} caracteres`);
    }
  }
  return segredos;
}

/**
 * Conexão com o Valkey — pub/sub do SSE entre tasks e contador do rate limit.
 *
 * Vazio desliga, e aí tudo funciona como antes dele: registro de SSE e rate limit
 * na memória do processo. É o `npm run dev` sem nada instalado.
 *
 * Três regras, todas vindas do que o ElastiCache Serverless exige (spike do PR 3):
 *
 *   - `rediss://` liga TLS; `VALKEY_CLUSTER=true` sem TLS é recusado, porque o
 *     Serverless só fala TLS e o erro de conectar em claro é um timeout mudo;
 *   - usuário e senha vêm de `VALKEY_USER`/`VALKEY_PASS` (Secrets Manager), nunca
 *     da URL: URL vai parar em log, variável de segredo não;
 *   - o nome do host é preservado para o SNI do TLS — o certificado é do nome.
 */
function valkeyConfig(env = process.env) {
  const bruto = env.VALKEY_URL?.trim();
  if (!bruto) return null;

  let url;
  try {
    url = new URL(bruto);
  } catch {
    throw new Error('VALKEY_URL inválida: use redis://host:porta ou rediss://host:porta');
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(`VALKEY_URL com protocolo "${url.protocol}": use redis:// ou rediss://`);
  }
  if (url.password) {
    throw new Error('VALKEY_URL não pode carregar senha: use VALKEY_USER e VALKEY_PASS');
  }

  const tls = url.protocol === 'rediss:';
  const cluster = env.VALKEY_CLUSTER?.trim() === 'true';
  if (cluster && !tls) {
    throw new Error('VALKEY_CLUSTER=true exige rediss:// — o ElastiCache Serverless só aceita TLS');
  }

  const porta = url.port ? Number(url.port) : 6379;
  return {
    host: url.hostname,
    port: porta,
    tls,
    cluster,
    username: env.VALKEY_USER?.trim() || undefined,
    password: env.VALKEY_PASS || undefined,
  };
}

/** Regra de nome de bucket S3 (3–63, minúsculas, dígitos, ponto e hífen). */
const NOME_BUCKET = /^(?!xn--)(?!.*\.\.)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * Onde as imagens enviadas ficam guardadas.
 *
 * Vazio: disco local (`backend/uploads`), servido pelo próprio Express — o Docker
 * e o `npm run dev`. Com `UPLOADS_BUCKET`: S3, servido pelo CloudFront em
 * `/uploads/*`. O disco de uma task Fargate some a cada deploy, então em produção
 * o bucket não é opção.
 *
 * `AWS_REGION` é exigida junto com o bucket: o SDK até a acha sozinho no ECS, mas
 * um processo que sobe sem ela em outro lugar falharia só no primeiro upload.
 */
function uploadsConfig(env = process.env) {
  const bucket = env.UPLOADS_BUCKET?.trim();
  if (!bucket) return { destino: 'disco' };

  if (!NOME_BUCKET.test(bucket)) {
    throw new Error(`UPLOADS_BUCKET "${bucket}" não é um nome de bucket S3 válido`);
  }
  const regiao = env.AWS_REGION?.trim();
  if (!regiao) {
    throw new Error('UPLOADS_BUCKET exige AWS_REGION (a região do bucket)');
  }
  return { destino: 's3', bucket, regiao };
}

/**
 * O Fargate espera no máximo 120s entre o SIGTERM e o SIGKILL (`stopTimeout`).
 * Atraso + prazo de fechamento precisam caber nisso com folga.
 */
const TETO_DESLIGAMENTO_MS = 115000;

/**
 * Os dois tempos do desligamento.
 *
 * - `atrasoMs` (`PRE_STOP_DELAY_MS`): depois do SIGTERM, quanto tempo a task
 *   continua atendendo **normalmente**. Sem balanceador, o CloudFront acha a task
 *   pelo DNS, e o registro ainda aponta para ela por até um TTL depois que o ECS
 *   decide pará-la. Fechar na hora derruba essas requisições. Padrão 0: no Docker
 *   local e no dev não há DNS a esperar.
 * - `limiteMs` (`SHUTDOWN_TIMEOUT_MS`): depois do atraso, quanto o fechamento
 *   (conexões, streams, Valkey, banco) pode levar antes de o processo sair à força.
 *
 * A soma é validada na subida: um atraso que não cabe no `stopTimeout` faria o
 * SIGKILL chegar no meio do fechamento — e isso só apareceria no primeiro deploy.
 */
function desligamentoConfig(env = process.env) {
  const inteiro = (chave, padrao, minimo) => {
    const bruto = env[chave]?.trim();
    const n = Number(bruto || padrao);
    if (!Number.isInteger(n) || n < minimo) {
      throw new Error(`${chave} precisa ser um inteiro >= ${minimo} (veio "${bruto}")`);
    }
    return n;
  };
  const atrasoMs = inteiro('PRE_STOP_DELAY_MS', 0, 0);
  const limiteMs = inteiro('SHUTDOWN_TIMEOUT_MS', 10000, 1000);
  if (atrasoMs + limiteMs > TETO_DESLIGAMENTO_MS) {
    throw new Error(
      `PRE_STOP_DELAY_MS + SHUTDOWN_TIMEOUT_MS = ${atrasoMs + limiteMs}ms passa de ${TETO_DESLIGAMENTO_MS}ms: ` +
        'o Fargate mata o processo aos 120s'
    );
  }
  return { atrasoMs, limiteMs };
}

module.exports = {
  desligamentoConfig,
  TETO_DESLIGAMENTO_MS,
  uploadsConfig,
  valkeyConfig,
  corsOrigins,
  trustProxy,
  dbSsl,
  sseHeartbeatMs,
  jwtSecret,
  segredosOrigem,
  ORIGENS_DEV,
  TAMANHO_MINIMO_SEGREDO,
};
