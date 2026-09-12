const { v4: uuidv4 } = require('uuid');

/**
 * Quantas notificações cada pessoa guarda.
 *
 * A leitura mostra 50, então 100 nunca perde nada que a tela mostraria — e
 * limita a tabela a `usuários × 100` de forma determinística. Medido antes do
 * teto: 1.534 linhas para 51 pessoas, com 98,8% nunca lidas. Não é caixa de
 * entrada, é mural de avisos; o que importa não é a idade, é quantas cabem.
 */
const TETO_POR_USUARIO = 100;

/**
 * Grava notificações para os jogadores de um evento.
 *
 * Só jogadores com conta recebem: convidados avulsos (`user_id` NULL) existem
 * apenas dentro do evento e não têm caixa de entrada. Recebe o handle de conexão
 * (`db` ou uma transação) para que a notificação nasça e morra junto com a
 * mudança que a gerou — avisar sobre uma rodada que deu rollback seria pior do
 * que não avisar.
 *
 * Guarda o **código** e os parâmetros, nunca a frase montada: quem decide o
 * idioma é a tela de quem lê, não o servidor no instante em que escreveu. A
 * coluna `message` fica nula aqui — ela só existe para as linhas antigas.
 */
async function notifyUsers(conn, userIds, code, params = null) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;

  const serial = params ? JSON.stringify(params) : null;
  const values = unique.map(() => '(?, ?, ?, ?)').join(', ');
  const valores = unique.flatMap((userId) => [uuidv4(), userId, code, serial]);
  await conn.run(
    `INSERT INTO notifications (id, user_id, code, params) VALUES ${values}`,
    valores
  );

  await aparar(conn, unique);
}

/**
 * Descarta o que passou do teto, por pessoa.
 *
 * Na mesma transação da escrita de propósito: um expurgo em outro lugar — cron,
 * rotina de manutenção — seria mais uma peça para existir, configurar e
 * esquecer. Aqui o crescimento é limitado no instante em que acontece.
 */
async function aparar(conn, userIds) {
  for (const userId of userIds) {
    const corte = await conn.get(
      'SELECT created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1 OFFSET ?',
      [userId, TETO_POR_USUARIO]
    );
    if (!corte) continue;
    await conn.run('DELETE FROM notifications WHERE user_id = ? AND created_at <= ?',
      [userId, corte.created_at]);
  }
}

// Todos os jogadores ativos de um evento que têm conta.
async function activeEventUserIds(conn, eventId) {
  const rows = await conn.query(
    "SELECT user_id FROM event_players WHERE event_id = ? AND status = 'active' AND user_id IS NOT NULL",
    [eventId]
  );
  return rows.map((r) => r.user_id);
}

// Donos das contas sentadas num pareamento (ignora convidados e assentos vazios).
async function pairingUserIds(conn, pairing) {
  const seats = [pairing.player1_id, pairing.player2_id, pairing.player3_id, pairing.player4_id].filter(Boolean);
  if (seats.length === 0) return [];
  const rows = await conn.query(
    `SELECT user_id FROM event_players WHERE user_id IS NOT NULL AND id IN (${seats.map(() => '?').join(',')})`,
    seats
  );
  return rows.map((r) => r.user_id);
}

module.exports = { notifyUsers, activeEventUserIds, pairingUserIds, TETO_POR_USUARIO };
