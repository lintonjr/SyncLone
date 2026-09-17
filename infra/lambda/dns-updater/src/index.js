const { processarEvento, lerConfig } = require('./reconciliar');
const { criarAws } = require('./aws');

// Fora do handler: clientes e configuração são reaproveitados entre invocações.
// Configuração inválida derruba a inicialização — e aparece no primeiro teste.
const config = lerConfig();
const aws = criarAws();

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Disparada por mudança de estado das tasks do serviço e por um agendamento de
 * 1 minuto. Ver reconciliar.js.
 */
exports.handler = (evento) =>
  processarEvento(evento, { aws, config, log: console, esperar, agora: Date.now });
