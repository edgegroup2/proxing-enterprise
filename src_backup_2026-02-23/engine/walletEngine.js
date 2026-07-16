/**
 * WALLET ENGINE (ALIGNED WITH LEDGER TRIGGERS)
 * --------------------------------------------
 * Wallet balance is updated by DB trigger.
 * We NEVER manually update wallets table.
 */

const db = require("../db");

/* ======================================================
   CREDIT
====================================================== */

async function credit({ userId, amount, reference, provider = "system" }) {

  const client = await db.connect();

  try {
    if (!userId || !amount || !reference)
      throw new Error("Missing parameters");

    if (Number(amount) <= 0)
      throw new Error("Invalid credit amount");

    await client.query("BEGIN");

    // Idempotency check
    const existing = await client.query(
      `SELECT 1 FROM ledger_entries WHERE reference = $1`,
      [reference]
    );

    if (existing.rowCount > 0) {
      await client.query("ROLLBACK");
      return { success: true, message: "Already processed" };
    }

    // Lock wallet row
    const wallet = await client.query(
      `SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );

    if (wallet.rowCount === 0)
      throw new Error("Wallet not found");

    const walletId = wallet.rows[0].id;
    const balanceBefore = Number(wallet.rows[0].balance);
    const balanceAfter = balanceBefore + Number(amount);

    // Insert transaction
    const tx = await client.query(
      `INSERT INTO transactions
       (user_id, type, amount, status, reference, provider, channel, created_at)
       VALUES ($1, 'credit', $2, 'success', $3, $4, 'wallet', NOW())
       RETURNING id`,
      [userId, amount, reference, provider]
    );

    const transactionId = tx.rows[0].id;

    // Insert ledger entry (trigger updates wallet)
    await client.query(
      `INSERT INTO ledger_entries
       (user_id, wallet_id, type, amount,
        balance_before, balance_after,
        reference, transaction_id, created_at)
       VALUES ($1,$2,'credit',$3,$4,$5,$6,$7,NOW())`,
      [
        userId,
        walletId,
        amount,
        balanceBefore,
        balanceAfter,
        reference,
        transactionId
      ]
    );

    await client.query("COMMIT");
    return { success: true };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/* ======================================================
   DEBIT
====================================================== */

async function debit({ userId, amount, reference, provider = "system" }) {

  const client = await db.connect();

  try {
    if (!userId || !amount || !reference)
      throw new Error("Missing parameters");

    if (Number(amount) <= 0)
      throw new Error("Invalid debit amount");

    await client.query("BEGIN");

    // Idempotency check
    const existing = await client.query(
      `SELECT 1 FROM ledger_entries WHERE reference = $1`,
      [reference]
    );

    if (existing.rowCount > 0) {
      await client.query("ROLLBACK");
      return { success: true, message: "Already processed" };
    }

    // Lock wallet row
    const wallet = await client.query(
      `SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );

    if (wallet.rowCount === 0)
      throw new Error("Wallet not found");

    const walletId = wallet.rows[0].id;
    const balanceBefore = Number(wallet.rows[0].balance);

    if (balanceBefore < Number(amount))
      throw new Error("Insufficient balance");

    const balanceAfter = balanceBefore - Number(amount);

    // Insert transaction
    const tx = await client.query(
      `INSERT INTO transactions
       (user_id, type, amount, status, reference, provider, channel, created_at)
       VALUES ($1, 'debit', $2, 'success', $3, $4, 'wallet', NOW())
       RETURNING id`,
      [userId, amount, reference, provider]
    );

    const transactionId = tx.rows[0].id;

    // Insert ledger entry (trigger handles balance update)
    await client.query(
      `INSERT INTO ledger_entries
       (user_id, wallet_id, type, amount,
        balance_before, balance_after,
        reference, transaction_id, created_at)
       VALUES ($1,$2,'debit',$3,$4,$5,$6,$7,NOW())`,
      [
        userId,
        walletId,
        amount,
        balanceBefore,
        balanceAfter,
        reference,
        transactionId
      ]
    );

    await client.query("COMMIT");
    return { success: true };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  credit,
  debit,
};
