const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const dbPath = path.resolve(process.env.DB_PATH || './data/manasync.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    city TEXT,
    address TEXT,
    online INTEGER NOT NULL DEFAULT 0,
    thumbnail TEXT,
    date TEXT NOT NULL,
    game TEXT NOT NULL,
    format TEXT,
    pairing_method TEXT NOT NULL DEFAULT 'swiss',
    playoff_structure TEXT NOT NULL DEFAULT 'none',
    allow_byes INTEGER NOT NULL DEFAULT 0,
    test_event INTEGER NOT NULL DEFAULT 0,
    collaborative_deck INTEGER NOT NULL DEFAULT 0,
    async_draws INTEGER NOT NULL DEFAULT 0,
    confirm_players INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'upcoming',
    current_round INTEGER NOT NULL DEFAULT 0,
    owner_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS event_players (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    deck_name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (event_id) REFERENCES events(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (event_id) REFERENCES events(id)
  );

  CREATE TABLE IF NOT EXISTS pairings (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    player1_id TEXT NOT NULL,
    player2_id TEXT,
    result TEXT,
    table_number INTEGER,
    FOREIGN KEY (round_id) REFERENCES rounds(id),
    FOREIGN KEY (event_id) REFERENCES events(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

module.exports = db;
