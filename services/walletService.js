const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const db = new sqlite3.Database("./db.sqlite");

// Create table if not exists
db.run(`
  CREATE TABLE IF NOT EXISTS wallets (
    user_id TEXT PRIMARY KEY,
    balance INTEGER
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    type TEXT,
    source TEXT,
    amount INTEGER,
    reference TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

function getBalance(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT balance FROM wallets WHERE user_id = ?",
      [userId],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.balance : 0);
      }
    );
  });
}

function debit(userId, amount, reference = "system") {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE wallets SET balance = balance - ? WHERE user_id = ?",
      [amount, userId],
      function (err) {
        if (err) return reject(err);

        // Ledger record
        db.run(
          `
          INSERT INTO transactions
          (id, user_id, type, source, amount, reference, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            uuidv4(),
            userId,
            "debit",
            "wallet",
            amount,
            reference,
            "success"
          ],
          function (err2) {
            if (err2) return reject(err2);
            resolve(true);
          }
        );
      }
    );
  });
}

function credit(userId, amount, reference = "system") {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO wallets (user_id, balance)
      VALUES (?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET balance = balance + ?
      `,
      [userId, amount, amount],
      function (err) {
        if (err) return reject(err);

        // Ledger record
        db.run(
          `
          INSERT INTO transactions
          (id, user_id, type, source, amount, reference, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            uuidv4(),
            userId,
            "credit",
            "wallet",
            amount,
            reference,
            "success"
          ],
          function (err2) {
            if (err2) return reject(err2);
            resolve(true);
          }
        );
      }
    );
  });
}

// Rollback debit (used when external provider fails)
function rollbackDebit(userId, amount, reference = "rollback") {
  return credit(userId, amount, reference);
}

module.exports = {
  getBalance,
  debit,
  credit,
  rollbackDebit
};
