const { Pool } = require("pg");
const fetch = require("node-fetch");

// Database connection (no assumptions beyond DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Paystack secret
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

async function verifyPaystack(reference) {
  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${reference}`,
    {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
      },
    }
  );

  const json = await res.json();
  return json?.data;
}

async function reconcilePaystackFundings() {
  const client = await pool.connect();

  try {
    // Select ONLY Paystack pending fundings
    const { rows } = await client.query(`
      SELECT *
      FROM fundings
      WHERE
        provider = 'paystack'
        AND status = 'pending'
        AND credited_at IS NULL
        AND created_at < now() - interval '2 minutes'
    `);

    if (rows.length === 0) {
      console.log("[reconcile] No Paystack fundings to reconcile");
      return;
    }

    for (const funding of rows) {
      if (!funding.reference) continue;

      const tx = await verifyPaystack(funding.reference);
      if (!tx || tx.status !== "success") continue;

      await client.query("BEGIN");

      // Idempotency check
      const exists = await client.query(
        `SELECT 1 FROM transactions WHERE reference = $1 LIMIT 1`,
        [funding.reference]
      );

      if (exists.rowCount > 0) {
        await client.query("ROLLBACK");
        continue;
      }

      const creditedAt = new Date();

      // Credit wallet (DO NOT change balance column names)
      await client.query(
        `UPDATE wallets
         SET balance = balance + $1
         WHERE user_id = $2`,
        [funding.amount, funding.user_id]
      );

      // Record transaction
      await client.query(
        `INSERT INTO transactions (user_id, amount, reference, type)
         VALUES ($1, $2, $3, 'credit')`,
        [funding.user_id, funding.amount, funding.reference]
      );

      // Update funding + SLA
      await client.query(
        `UPDATE fundings
         SET status = 'success',
             credited_at = $1,
             sla_seconds = EXTRACT(EPOCH FROM ($1 - created_at))::int
         WHERE id = $2`,
        [creditedAt, funding.id]
      );

      await client.query("COMMIT");

      console.log(
        `[reconcile] Credited Paystack funding ${funding.reference}`
      );
    }
  } catch (err) {
    console.error("[reconcile] Error:", err);
  } finally {
    client.release();
  }
}

reconcilePaystackFundings()
  .then(() => {
    console.log('[reconcile] Done');
    process.exit(0);
  })
  .catch(err => {
    console.error('[reconcile] Fatal error:', err);
    process.exit(1);
  });
