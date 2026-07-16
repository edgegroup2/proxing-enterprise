'use strict';

const db = require('../db');
const fetch = require('node-fetch');
const walletService = require('../services/walletService');

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
  return json.data;
}

async function reconcilePaystackFundings() {
  const client = await db.connect();

  try {
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
      console.log('[reconcile] No Paystack fundings to reconcile');
      return;
    }

    for (const funding of rows) {
      if (!funding.reference) continue;

      const tx = await verifyPaystack(funding.reference);

      if (!tx || tx.status !== 'success') continue;

      await client.query('BEGIN');

      try {
        const freshFunding = await client.query(
          `
          SELECT user_id, amount, reference, provider, status, credited_at, created_at
          FROM fundings
          WHERE id = $1
          LIMIT 1
          `,
          [funding.id]
        );

        if (freshFunding.rowCount === 0) {
          await client.query('ROLLBACK');
          continue;
        }

        const currentFunding = freshFunding.rows[0];

        if (currentFunding.status === 'success' || currentFunding.credited_at) {
          await client.query('ROLLBACK');
          continue;
        }

        const creditedAt = new Date();

        await client.query(
          `
          UPDATE fundings
          SET
            status = 'success',
            credited_at = $1,
            sla_seconds = EXTRACT(EPOCH FROM ($1 - created_at))::int
          WHERE id = $2
          `,
          [creditedAt, funding.id]
        );

        await client.query('COMMIT');

        await walletService.creditWallet(
          currentFunding.user_id,
          Number(currentFunding.amount),
          currentFunding.reference,
          currentFunding.provider || 'paystack'
        );

        console.log(
          `[reconcile] Credited Paystack funding ${currentFunding.reference}`
        );
      } catch (innerErr) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}

        console.error('[reconcile] Inner Error:', innerErr);
      }
    }
  } catch (err) {
    console.error('[reconcile] Error:', err);
  } finally {
    client.release();
  }
}

reconcilePaystackFundings()
  .then(() => {
    console.log('[reconcile] Done');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[reconcile] Fatal error:', err);
    process.exit(1);
  });
