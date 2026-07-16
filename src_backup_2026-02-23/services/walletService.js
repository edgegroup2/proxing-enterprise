const db = require("../db");
const { v4: uuidv4 } = require("uuid");

async function getBalance(userId) {
  const result = await db.query(
    `
    SELECT COALESCE(SUM(
      CASE 
        WHEN type = 'credit' THEN amount
        WHEN type = 'debit' THEN -amount
        ELSE 0
      END
    ), 0) AS balance
    FROM wallet_transactions
    WHERE user_id = $1
    `,
    [userId]
  );

  return result.rows[0].balance;
}

async function credit(userId, amount, reference = "system", description = "Wallet credit") {
  await db.query(
    `
    INSERT INTO wallet_transactions
    (user_id, type, amount, reference, description)
    VALUES ($1, 'credit', $2, $3, $4)
    `,
    [userId, amount, reference, description]
  );

  return true;
}

async function debit(userId, amount, reference = "system", description = "Wallet debit") {
  const balance = await getBalance(userId);

  if (Number(balance) < Number(amount)) {
    throw new Error("Insufficient balance");
  }

  await db.query(
    `
    INSERT INTO wallet_transactions
    (user_id, type, amount, reference, description)
    VALUES ($1, 'debit', $2, $3, $4)
    `,
    [userId, amount, reference, description]
  );

  return true;
}

async function rollbackDebit(userId, amount, reference = "rollback") {
  return credit(userId, amount, reference, "Rollback credit");
}

module.exports = {
  getBalance,
  credit,
  debit,
  rollbackDebit,
};
