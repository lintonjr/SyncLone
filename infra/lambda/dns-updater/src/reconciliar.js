/**
 * Mantém `origin.<domínio>` apontando para as tasks saudáveis do backend.
 *
 * Existe porque não há balanceador: o CloudFront chega às tasks pelo DNS, e uma
 * task Fargate troca de IP a cada deploy. Esta função é o que compra de volta os
 * ~US$ 22/mês de um ALB — e deve ser apagada no dia em que ele entrar.
 *
 * Em vez de reagir ao evento ("a task X subiu, grave o IP dela"), ela **reconcilia**:
 * a cada chamada, olha o estado inteiro do serviço e grava o conjunto de IPs que
 * deveria existir. Por isso tanto faz o que a disparou — mudança de estado de
 * task ou o agendamento de 1 minuto —, e por isso eventos perdidos, duplicados ou
 * fora de ordem não deixam o registro errado por mais de um minuto.
 *
 * Quem entra no registro: task `RUNNING`, `HEALTHY` (health check do container) e
 * que **não** está sendo parada (`desiredStatus` ainda `RUNNING`). Esta última é
 * a que tira a task velha do DNS no instante em que o ECS decide pará-la — ela
 * continua atendendo por PRE_STOP_DELAY_MS enquanto o DNS converge.
 *
 * Toda chamada à AWS passa pelo adaptador (`aws`), injetado: a lógica é testada
 * sem SDK e sem conta.
 */

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const TENTATIVAS_GRAVACAO = 3;

const normalizarNome = (nome) => String(nome).toLowerCase().replace(/\.$/, '');
const mesmoConjunto = (a, b) => {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
};

function lerConfig(env = process.env) {
  const obrigatorio = (chave) => {
    const v = env[chave]?.trim();
    if (!v) throw new Error(`${chave} não definido`);
    return v;
  };
  const inteiro = (chave, padrao, min, max) => {
    const n = Number(env[chave]?.trim() || padrao);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${chave} fora de ${min}..${max}`);
    return n;
  };
  return {
    cluster: obrigatorio('CLUSTER_ARN'),
    servico: obrigatorio('SERVICE_NAME'),
    zona: obrigatorio('HOSTED_ZONE_ID'),
    registro: normalizarNome(obrigatorio('RECORD_NAME')),
    ttl: inteiro('TTL', 30, 10, 300),
    // Precisa caber no timeout da Lambda (30 s) com folga para as chamadas.
    esperaSaudeMs: inteiro('ESPERA_SAUDE_MS', 20000, 0, 25000),
  };
}

/** A task pode entrar no DNS agora? */
const publicavel = (task) =>
  task.lastStatus === 'RUNNING' && task.desiredStatus === 'RUNNING' && task.healthStatus === 'HEALTHY';

const eniDaTask = (task) =>
  (task.attachments ?? [])
    .find((a) => a.type === 'ElasticNetworkInterface')
    ?.details?.find((d) => d.name === 'networkInterfaceId')?.value;

/**
 * Task que acabou de subir: espera ela ficar saudável, dentro do prazo.
 *
 * Com `minHealthyPercent: 100`, o ECS só para a task velha quando a nova passa no
 * health check. Publicar a nova **antes** disso é o que faz os dois IPs
 * coexistirem no DNS por um instante. Se o prazo acabar antes, não há perda: o
 * evento da parada da velha, ou o agendamento, reconcilia de novo.
 */
async function esperarSaude(taskArn, { aws, config, log, esperar, agora }) {
  const limite = agora() + config.esperaSaudeMs;
  for (;;) {
    const [task] = await aws.descreverTasks(config.cluster, [taskArn]);
    if (!task || task.lastStatus !== 'RUNNING' || task.desiredStatus !== 'RUNNING') return 'desistiu';
    if (task.healthStatus === 'HEALTHY') return 'saudavel';
    if (agora() >= limite) {
      log.log(JSON.stringify({ dns: 'espera-saude-esgotada', task: taskArn, healthStatus: task.healthStatus }));
      return 'prazo';
    }
    await esperar(5000);
  }
}

/** Os IPs públicos que deveriam estar no registro agora. */
async function ipsDesejados({ aws, config, log }) {
  const arns = await aws.listarTasks(config.cluster, config.servico);
  if (!arns.length) return [];

  const tasks = (await aws.descreverTasks(config.cluster, arns)).filter(publicavel);
  const enis = tasks.map(eniDaTask).filter(Boolean);
  if (enis.length !== tasks.length) {
    log.log(JSON.stringify({ dns: 'task-sem-eni', tasks: tasks.length, enis: enis.length }));
  }
  if (!enis.length) return [];

  const ips = (await aws.ipsPublicos(enis)).filter((ip) => IPV4.test(ip));
  return [...new Set(ips)].sort();
}

/**
 * Grava o conjunto, com controle de concorrência.
 *
 * Duas execuções simultâneas podem ter lido estados diferentes; sem cuidado, a
 * mais lenta escreveria por cima da mais nova um IP que já parou. O lote do
 * Route 53 é atômico: **apaga exatamente os valores lidos e cria os novos**. Se
 * outra execução mudou o registro entre a leitura e a escrita, o `DELETE` não
 * bate, o lote inteiro é recusado, e a reconciliação recomeça com o estado novo.
 */
async function reconciliar(ctx) {
  const { aws, config, log } = ctx;

  for (let tentativa = 1; tentativa <= TENTATIVAS_GRAVACAO; tentativa++) {
    const desejados = await ipsDesejados(ctx);
    const atual = await aws.lerRegistro(config.zona, config.registro);
    const atuais = atual?.valores ?? [];

    if (!desejados.length) {
      // Apagar o registro não ajuda ninguém: o CloudFront trocaria "conexão
      // recusada" por "nome inexistente". Fica como está, e o aviso vai para o log.
      log.warn(JSON.stringify({ dns: 'nenhuma-task-saudavel', mantido: atuais }));
      return { acao: 'mantido-sem-tasks', ips: atuais };
    }

    if (atual && mesmoConjunto(atuais, desejados) && atual.ttl === config.ttl) {
      return { acao: 'sem-mudanca', ips: desejados };
    }

    try {
      await aws.trocarRegistro(config.zona, config.registro, { anterior: atual, valores: desejados, ttl: config.ttl });
      log.log(JSON.stringify({ dns: 'atualizado', registro: config.registro, de: atuais, para: desejados, tentativa }));
      return { acao: 'atualizado', ips: desejados, anteriores: atuais };
    } catch (err) {
      if (err.name !== 'InvalidChangeBatch' || tentativa === TENTATIVAS_GRAVACAO) throw err;
      log.log(JSON.stringify({ dns: 'concorrencia', tentativa, detalhe: err.message }));
    }
  }
  throw new Error('inalcançável');
}

/** Ponto de entrada da lógica: qualquer evento vira uma reconciliação. */
async function processarEvento(evento, ctx) {
  const detalhe = evento?.detail ?? {};
  const origem = evento?.['detail-type'] ?? evento?.source ?? 'desconhecida';

  let espera = null;
  if (
    evento?.['detail-type'] === 'ECS Task State Change' &&
    detalhe.lastStatus === 'RUNNING' &&
    detalhe.desiredStatus === 'RUNNING' &&
    detalhe.taskArn &&
    ctx.config.esperaSaudeMs > 0
  ) {
    espera = await esperarSaude(detalhe.taskArn, ctx);
  }

  const resultado = await reconciliar(ctx);
  ctx.log.log(JSON.stringify({ dns: 'reconciliado', origem, espera, ...resultado }));
  return resultado;
}

module.exports = { processarEvento, reconciliar, ipsDesejados, esperarSaude, lerConfig, publicavel, IPV4 };
