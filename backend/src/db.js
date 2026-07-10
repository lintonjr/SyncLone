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

const db = {
  // Returns all rows
  query: async (sql, params = []) => {
    const [rows] = await pool.execute(sql, params);
    return rows;
  },
  // Returns first row or null
  get: async (sql, params = []) => {
    const [rows] = await pool.execute(sql, params);
    return rows[0] ?? null;
  },
  // Executes INSERT/UPDATE/DELETE, returns result metadata
  run: async (sql, params = []) => {
    const [result] = await pool.execute(sql, params);
    return result;
  },
  pool,
};

module.exports = db;
