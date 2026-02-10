const db = require("../db");

async function reconcilePendingTransactions() {
  const { rows } = await db.query(`
    SELECT id, reference, channel
    FROM transactions
    WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '5 minutes'
    LIMIT 20
  `);

  for (const tx of rows) {
    try {
      if (tx.channel === "paystack") {
        // rely on Paystack verify endpoint
        await verifyPaystackInternally(tx.reference);
      }

      if (tx.channel === "monnify") {
        await verifyMonnifyInternally(tx.reference);
      }
    } catch (err) {
      console.error("Reconciliation failed:", tx.reference, err.message);
    }
  }
}

module.exports = { reconcilePendingTransactions };
