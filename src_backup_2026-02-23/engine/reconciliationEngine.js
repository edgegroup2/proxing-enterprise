const db = require('../db');

async function reconcileSystemIntegrity() {
  const client = await db.getClient();

  try {
    const walletSum = await client.query(
      `SELECT COALESCE(SUM(balance),0) AS total FROM wallets`
    );

    const ledgerSum = await client.query(
      `
      SELECT COALESCE(SUM(
        CASE 
          WHEN type='credit' THEN amount
          WHEN type='debit' THEN -amount
          ELSE 0
        END
      ),0) AS total
      FROM ledger_entries
      `
    );

    const walletTotal = Number(walletSum.rows[0].total);
    const ledgerTotal = Number(ledgerSum.rows[0].total);

    if (walletTotal !== ledgerTotal) {
      console.error('CRITICAL DRIFT DETECTED', {
        walletTotal,
        ledgerTotal
      });
    }

    return {
      walletTotal,
      ledgerTotal,
      status: walletTotal === ledgerTotal ? 'OK' : 'DRIFT'
    };

  } finally {
    client.release();
  }
}

module.exports = { reconcileSystemIntegrity };
