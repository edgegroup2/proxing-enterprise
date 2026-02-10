const pool = require("../db/pool");
const logger = require("../utils/logger");

async function processWithdrawals() {
  let client;

  try {
    client = await pool.connect();

    const { rows: withdrawals } = await client.query(`
      SELECT *
      FROM withdrawals
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 5
    `);

    if (withdrawals.length === 0) {
      return;
    }

    for (const withdrawal of withdrawals) {
      try {
        await processSingleWithdrawal(client, withdrawal);
      } catch (err) {
        logger.error(
          { id: withdrawal.id, err: err.message },
          "Withdrawal failed"
        );

        await client.query(
          `UPDATE withdrawals SET status = 'failed' WHERE id = $1`,
          [withdrawal.id]
        );
      }
    }
  } catch (err) {
    logger.error("Withdrawal cron failed:", err);
  } finally {
    // ✅ RELEASE ONCE — AND ONLY HERE
    if (client) {
      client.release();
    }
  }
}

async function processSingleWithdrawal(client, withdrawal) {
  // ❗ DO NOT release client here — EVER

  await client.query(
    `UPDATE withdrawals SET status = 'processing' WHERE id = $1`,
    [withdrawal.id]
  );

  // Simulated payout logic (Paystack / Bank API)
  // If this throws, caller handles it
  await fakePayout();

  await client.query(
    `UPDATE withdrawals SET status = 'completed' WHERE id = $1`,
    [withdrawal.id]
  );
}

async function fakePayout() {
  return true;
}

module.exports = {
  processWithdrawals
};
