const { v4: uuidv4 } = require('uuid');

/**
 * Grava notificações para os jogadores de um evento.
 *
 * Só jogadores com conta recebem: convidados avulsos (`user_id` NULL) existem
 * apenas dentro do evento e não têm caixa de entrada. Recebe o handle de conexão
 * (`db` ou uma transação) para que a notificação nasça e morra junto com a
 * mudança que a gerou — avisar sobre uma rodada que deu rollback seria pior do
 * que não avisar.
 */
async function notifyUsers(conn, userIds, message) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;

  const values = unique.map(() => '(?, ?, ?)').join(', ');
  const params = unique.flatMap((userId) => [uuidv4(), userId, message]);
  await conn.run(`INSERT INTO notifications (id, user_id, message) VALUES ${values}`, params);
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

module.exports = { notifyUsers, activeEventUserIds, pairingUserIds };
