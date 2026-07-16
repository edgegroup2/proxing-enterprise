'use strict';

const db = require('../db');
const { autoRepairTransactions } = require('../services/transactionAutoRepair');

async function run() {
  const result = await db.query(`
    SELECT
      id,
      user_id,
      reference,
      type,
      amount,
      provider,
      status,
      channel,
      meta,
      service_id,
      phone,
      created_at
    FROM transactions
    WHERE reference LIKE 'vtpass-%'
    ORDER BY created_at DESC
  `);

  const repaired = await autoRepairTransactions(db, result.rows, { persist: true });

  const summary = repaired.reduce((acc, row) => {
    const key = row.ui_label || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log('BACKFILL COMPLETE');
  console.log(summary);
  process.exit(0);
}

run().catch((err) => {
  console.error('BACKFILL FAILED', err);
  process.exit(1);
});
