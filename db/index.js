const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./db/proxing.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY,
    email TEXT,
    phone TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wallets(
    user_id TEXT PRIMARY KEY,
    balance INTEGER,
    locked INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions(
    id TEXT PRIMARY KEY,
    user_id TEXT,
    amount INTEGER,
    service TEXT,
    status TEXT,
    reference TEXT,
    created_at TEXT
  )`);
});

module.exports = db;
