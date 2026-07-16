'use strict';

const db = require('../db');
const { processCommission } = require('../services/commissionEngine');

async function reconcileCommissions() {
  const res = await db.query(
    `
    SELECT t.*
    FROM transactions t
    LEFT JOIN commission_ledger c
      ON t.reference = c.reference
    WHERE t.provider = 'vtpass'
      AND t.status = 'success'
      AND c.reference IS NULL
      AND t.meta IS NOT NULL
      AND COALESCE(t.meta::text, '') <> ''
      AND (t.meta->>'product_type') IS NOT NULL
      AND (t.meta->>'product_type') <> ''
    ORDER BY t.created_at ASC
    LIMIT 50
    `
  );

  for (const tx of res.rows) {
    try {
      await processCommission(tx);
    } catch (err) {
      console.error('Commission reconcile failed', {
        reference: tx.reference,
        error: err.message
      });
    }
  }
}

module.exports = { reconcileCommissions };
