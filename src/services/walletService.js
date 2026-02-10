const db = require("../db");

/**
 * Fetch wallet by user_id
 */
async function getWallet(userId) {
  const { rows } = await db.query(
    `SELECT * FROM wallets WHERE user_id = $1`,
    [userId]
  );
  return rows[0];
}

/**
 * Ensure sufficient balance before spending
 */
async function assertSufficientBalance(userId, amount) {
  const wallet = await getWallet(userId);

  if (!wallet) {
    throw new Error("Wallet not found");
  }

  if (Number(wallet.balance) < Number(amount)) {
    throw new Error("Insufficient wallet balance");
  }

  return wallet;
}

/**
 * Debit wallet safely (transactional)
 */
async function debitWallet({ userId, amount, reference, type, meta }) {
  return db.tx(async (t) => {
    await t.query(
      `INSERT INTO transactions
       (reference, user_id, amount, type, status, meta)
       VALUES ($1, $2, $3, $4, 'PENDING', $5)`,
      [reference, userId, amount, type, meta]
    );

    await t.query(
      `UPDATE wallets
       SET balance = balance - $1
       WHERE user_id = $2`,
      [amount, userId]
    );

    await t.query(
      `UPDATE transactions
       SET status = 'SUCCESS'
       WHERE reference = $1`,
      [reference]
    );
  });
}

module.exports = {
  getWallet,
  assertSufficientBalance,
  debitWallet,
};
