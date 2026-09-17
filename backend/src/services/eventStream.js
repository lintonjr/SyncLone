const crypto = require('crypto');

/**
 * Registro de streams SSE, por evento.
 *
 * Cada processo guarda na memória quem está olhando cada evento — um `Response`
 * aberto não viaja entre processos. O que viaja é o **aviso**: com um barramento
 * (Valkey), o broadcast desta task chega aos clientes conectados nas outras.
 * Sem barramento, é exatamente o registro local de antes, e basta para uma task.
 *
 * O módulo exporta uma instância padrão com a interface de sempre
 * (`subscribe`, `unsubscribe`, `broadcast`, `closeAll`). A fábrica existe para o
 * teste de integração criar duas "tasks" no mesmo processo.
 */

/**
 * O que pode chegar ao navegador.
 *
 * 'update' manda a tela recarregar o evento; 'deleted' avisa que não há mais o que
 * recarregar — sem isso a página ficaria viva apontando para um 404, porque o
 * refresh do cliente não trata erro.
 *
 * A lista é fechada porque o valor vai direto para `data: ...` no stream: uma
 * mensagem do barramento com quebra de linha injetaria eventos inteiros no
 * navegador de todo mundo que está olhando.
 */
const TIPOS = new Set(['update', 'deleted']);

const PREFIXO_CANAL = 'evento:';

function criarEventStream({ log = console, origem = crypto.randomUUID() } = {}) {
  const listeners = new Map(); // eventId -> Set<Response>
  let barramento = null;

  const canal = (eventId) => `${PREFIXO_CANAL}${eventId}`;

  function entregarLocal(eventId, kind) {
    const set = listeners.get(eventId);
    if (!set) return;
    for (const res of set) res.write(`data: ${kind}\n\n`);
  }

  function subscribe(eventId, res) {
    if (!listeners.has(eventId)) {
      listeners.set(eventId, new Set());
      // Só assina o evento que alguém nesta task está olhando: uma task não
      // recebe o tráfego de todos os torneios da plataforma.
      barramento?.assinar(canal(eventId));
    }
    listeners.get(eventId).add(res);
  }

  function unsubscribe(eventId, res) {
    const set = listeners.get(eventId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) {
      listeners.delete(eventId);
      barramento?.desassinar(canal(eventId));
    }
  }

  /**
   * Avisa quem está olhando o evento — aqui e nas outras tasks.
   *
   * A entrega local é imediata e não depende do barramento: se o Valkey estiver
   * fora do ar, os clientes desta task continuam atualizados. A mensagem leva a
   * `origem` para esta task reconhecer e ignorar o próprio eco.
   */
  function broadcast(eventId, kind = 'update') {
    if (!TIPOS.has(kind)) throw new Error(`tipo de broadcast desconhecido: ${kind}`);
    entregarLocal(eventId, kind);
    barramento?.publicar(canal(eventId), JSON.stringify({ origem, kind }));
  }

  /** Mensagem vinda de outra task. Qualquer coisa fora do formato é descartada. */
  function receber(canalRecebido, mensagem) {
    if (typeof canalRecebido !== 'string' || !canalRecebido.startsWith(PREFIXO_CANAL)) return;
    let dados;
    try {
      dados = JSON.parse(mensagem);
    } catch {
      log.warn(`[stream] mensagem ilegível em ${canalRecebido}, descartada`);
      return;
    }
    if (dados?.origem === origem) return;
    if (!TIPOS.has(dados?.kind)) {
      log.warn(`[stream] tipo inválido em ${canalRecebido}, descartado`);
      return;
    }
    entregarLocal(canalRecebido.slice(PREFIXO_CANAL.length), dados.kind);
  }

  /**
   * Liga o barramento. Eventos que já têm alguém olhando são assinados na hora —
   * a ordem de inicialização não pode deixar ninguém surdo.
   */
  function usarBarramento(novo) {
    barramento = novo;
    if (!novo) return;
    novo.aoReceber(receber);
    for (const eventId of listeners.keys()) novo.assinar(canal(eventId));
  }

  /**
   * Encerra todos os streams abertos e devolve quantos eram.
   *
   * Existe para o desligamento: uma conexão SSE não termina sozinha, é essa a
   * natureza dela. Sem fechar cada uma na mão, o `server.close()` fica esperando
   * para sempre por conexões que nunca vão acabar, o ECS perde a paciência e mata
   * o processo no SIGKILL — levando junto qualquer requisição que ainda estivesse
   * no meio de uma transação.
   *
   * Fechar o stream é benigno do lado do cliente: `EventSource` reconecta sozinho,
   * e cai na task nova. As assinaturas no barramento somem junto com a conexão do
   * assinante, fechada logo depois (lib/valkey.js#encerrar).
   */
  function closeAll() {
    let total = 0;
    for (const set of listeners.values()) {
      for (const res of set) {
        total++;
        try {
          res.end();
        } catch {
          // conexão já morta do outro lado
        }
      }
    }
    listeners.clear();
    return total;
  }

  return { subscribe, unsubscribe, broadcast, closeAll, usarBarramento, receber, origem };
}

const padrao = criarEventStream();

module.exports = { ...padrao, criarEventStream, TIPOS };
