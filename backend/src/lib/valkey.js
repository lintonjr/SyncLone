const IORedis = require('ioredis');
const { valkeyConfig } = require('./config');

/**
 * Clientes do Valkey: um para comandos, um para assinaturas.
 *
 * Dois porque uma conexão em modo de assinatura não executa mais nada — o
 * `SPUBLISH` do broadcast e o `INCR` do rate limit precisam de outra.
 *
 * As opções do modo cluster são as validadas contra o ElastiCache Serverless no
 * spike do PR 3 (infraestructure/aws/PLANO-DEPLOY.md §5.2). Cada uma existe por um
 * motivo que já custou uma execução:
 *
 *   - `dnsLookup` identidade: com TLS, o certificado é do **nome** do endpoint;
 *     resolver para IP quebra a verificação;
 *   - `shardedSubscribers`: `SSUBSCRIBE`/`SPUBLISH` roteados por shard;
 *   - o ready check padrão continua ligado — ele usa `CLUSTER INFO`, e é por isso
 *     que o usuário do Valkey precisa de `+cluster|info`. Sem a permissão, o
 *     cliente desiste **sem emitir erro nenhum**.
 */
function opcoesCluster(cfg) {
  return {
    dnsLookup: (endereco, cb) => cb(null, endereco),
    redisOptions: {
      tls: { servername: cfg.host },
      username: cfg.username,
      password: cfg.password,
      connectTimeout: 5000,
      maxRetriesPerRequest: 2,
    },
    shardedSubscribers: true,
    slotsRefreshTimeout: 5000,
    clusterRetryStrategy: (tentativa) => Math.min(tentativa * 200, 2000),
  };
}

function opcoesSimples(cfg) {
  return {
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    password: cfg.password,
    tls: cfg.tls ? { servername: cfg.host } : undefined,
    connectTimeout: 5000,
    maxRetriesPerRequest: 2,
    retryStrategy: (tentativa) => Math.min(tentativa * 200, 2000),
  };
}

/**
 * Log de conexão que não inunda.
 *
 * Um Valkey fora do ar gera um erro por tentativa de reconexão — várias por
 * segundo. Um aviso a cada 30s por cliente conta a história sem soterrar o resto.
 *
 * E há um caso que precisa de frase própria: o ElastiCache **fecha a conexão** em
 * vez de responder `WRONGPASS` quando a credencial está errada. Sem o aviso
 * específico, senha errada parece instabilidade de rede.
 */
function observar(cliente, nome, { log = console, agora = Date.now, intervaloMs = 30000 } = {}) {
  let ultimoAviso = -Infinity;
  let conectouEm = null;
  let pronto = false;

  const avisar = (mensagem) => {
    if (agora() - ultimoAviso < intervaloMs) return;
    ultimoAviso = agora();
    log.warn(`[valkey:${nome}] ${mensagem}`);
  };

  cliente.on('connect', () => { conectouEm = agora(); pronto = false; });
  cliente.on('ready', () => {
    if (!pronto) log.log(`[valkey:${nome}] conectado`);
    pronto = true;
  });
  cliente.on('error', (err) => avisar(`erro: ${err.message}`));
  cliente.on('node error', (err, endereco) => avisar(`erro no nó ${endereco}: ${err.message}`));
  cliente.on('close', () => {
    if (conectouEm !== null && !pronto && agora() - conectouEm < 2000) {
      avisar('conexão fechada logo após conectar — confira VALKEY_USER/VALKEY_PASS e as permissões do usuário');
    }
    conectouEm = null;
    pronto = false;
  });
}

function criarClientes(cfg, { log = console, Simples = IORedis, Cluster = IORedis.Cluster } = {}) {
  const novo = () =>
    cfg.cluster ? new Cluster([{ host: cfg.host, port: cfg.port }], opcoesCluster(cfg)) : new Simples(opcoesSimples(cfg));

  const comandos = novo();
  const assinante = novo();
  observar(comandos, 'comandos', { log });
  observar(assinante, 'assinante', { log });
  return { comandos, assinante };
}

/**
 * O barramento que o `eventStream` usa para falar com as outras tasks.
 *
 * Nenhuma falha do Valkey sobe para quem chamou: um broadcast que não chega às
 * outras tasks ainda chegou aos clientes desta, e derrubar a requisição que
 * gravou um resultado por causa do cache seria trocar um problema pequeno por um
 * grande.
 */
function criarBarramento({ comandos, assinante }, { log = console } = {}) {
  const falhou = (acao) => (err) => log.warn(`[valkey] ${acao} falhou: ${err.message}`);
  return {
    publicar: (canal, mensagem) => comandos.spublish(canal, mensagem).catch(falhou(`SPUBLISH ${canal}`)),
    assinar: (canal) => assinante.ssubscribe(canal).catch(falhou(`SSUBSCRIBE ${canal}`)),
    desassinar: (canal) => assinante.sunsubscribe(canal).catch(falhou(`SUNSUBSCRIBE ${canal}`)),
    aoReceber: (fn) => assinante.on('smessage', fn),
  };
}

let clientes;

/** Os clientes do processo, criados na primeira chamada; `null` sem `VALKEY_URL`. */
function obterClientes({ env = process.env, log = console } = {}) {
  if (clientes === undefined) {
    const cfg = valkeyConfig(env);
    clientes = cfg ? criarClientes(cfg, { log }) : null;
  }
  return clientes;
}

/**
 * Fecha as duas conexões no desligamento, sem deixar o processo pendurado.
 *
 * `quit` espera a resposta do servidor; se o Valkey estiver fora do ar, essa
 * resposta não vem — daí o prazo, depois do qual a conexão é simplesmente cortada.
 */
async function encerrar({ prazoMs = 2000 } = {}) {
  if (!clientes) return;
  const atuais = [clientes.comandos, clientes.assinante];
  clientes = null;
  await Promise.all(
    atuais.map(async (c) => {
      let timer;
      const prazo = new Promise((resolve) => { timer = setTimeout(resolve, prazoMs); });
      await Promise.race([c.quit().catch(() => {}), prazo]);
      clearTimeout(timer);
      c.disconnect();
    })
  );
}

module.exports = {
  obterClientes,
  criarClientes,
  criarBarramento,
  encerrar,
  observar,
  opcoesCluster,
  opcoesSimples,
};
