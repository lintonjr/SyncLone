// In-memory SSE registry, keyed by event id. Single Node process, no cluster/Redis needed.
const listeners = new Map(); // eventId -> Set<Response>

function subscribe(eventId, res) {
  if (!listeners.has(eventId)) listeners.set(eventId, new Set());
  listeners.get(eventId).add(res);
}

function unsubscribe(eventId, res) {
  const set = listeners.get(eventId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) listeners.delete(eventId);
}

// `kind` diz o que aconteceu. 'update' (o padrão) manda a tela recarregar o
// evento; 'deleted' avisa que não há mais o que recarregar — sem isso a página
// ficaria viva apontando para um 404, porque o refresh do cliente não trata erro.
function broadcast(eventId, kind = 'update') {
  const set = listeners.get(eventId);
  if (!set) return;
  for (const res of set) res.write(`data: ${kind}\n\n`);
}

module.exports = { subscribe, unsubscribe, broadcast };
