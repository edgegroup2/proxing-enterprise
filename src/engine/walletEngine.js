const db = require("../db"); // your pg connection

async function creditWallet(userId, amount, ref) {
  await db.query(
    "UPDATE wallets SET balance = balance + $1 WHERE user_id = $2",
    [amount, userId]
  );

  await db.query(
    "INSERT INTO transactions (user_id, type, amount, reference, status) VALUES ($1,'credit',$2,$3,'success')",
    [userId, amount, ref]
  );
}

async function debitWallet(userId, amount, ref) {
  const { rows } = await db.query(
    "SELECT balance FROM wallets WHERE user_id = $1",
    [userId]
  );

  if (rows[0].balance < amount) {
    throw new Error("Insufficient wallet balance");
  }

  await db.query(
    "UPDATE wallets SET balance = balance - $1 WHERE user_id = $2",
    [amount, userId]
  );

  await db.query(
    "INSERT INTO transactions (user_id, type, amount, reference, status) VALUES ($1,'debit',$2,$3,'success')",
    [userId, amount, ref]
  );
}

module.exports = { creditWallet, debitWallet };
