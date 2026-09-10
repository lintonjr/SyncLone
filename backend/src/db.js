const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'root123',
  database: process.env.DB_NAME || 'manasync',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '+00:00',
});

// The same three helpers, bound either to the pool or to a single connection
// held open by a transaction.
const helpers = (target) => ({
  // Returns all rows
  query: async (sql, params = []) => {
    const [rows] = await target.execute(sql, params);
    return rows;
  },
  // Returns first row or null
  get: async (sql, params = []) => {
    const [rows] = await target.execute(sql, params);
    return rows[0] ?? null;
  },
  // Executes INSERT/UPDATE/DELETE, returns result metadata
  run: async (sql, params = []) => {
    const [result] = await target.execute(sql, params);
    return result;
  },
});

/**
 * Runs `fn` inside a transaction, handing it a connection-bound {query,get,run}.
 * Commits on return, rolls back on throw — including the HttpErrors routes throw
 * to reject a request, so a rejected write never leaves half of it applied.
 *
 * Every handler that moves points (submitting, approving, undoing a result, and
 * pairing a round, which auto-awards byes) has to go through here: those are
 * sequences of dependent UPDATEs, and a partial application silently corrupts
 * the standings with no way to detect it afterwards.
 */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(helpers(conn));
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

const db = { ...helpers(pool), transaction, pool };

module.exports = db;
