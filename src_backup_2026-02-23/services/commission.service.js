const db = require('../db');

async function processAgentCommission(userId, transactionAmount, reference) {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const refRes = await client.query(
      `
      SELECT referred_by, commission_rate
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [userId]
    );

    if (!refRes.rows.length || !refRes.rows[0].referred_by) {
      await client.query('ROLLBACK');
      return;
    }

    const agentId = refRes.rows[0].referred_by;
    const rate = Number(refRes.rows[0].commission_rate || 1);

    const commission = (transactionAmount * rate) / 100;

    if (commission <= 0) {
      await client.query('ROLLBACK');
      return;
    }

    // Idempotent reference
    const commissionRef = `commission_${reference}`;

    await client.query(
      `SELECT wallet_credit($1,$2,$3)`,
      [agentId, commission, commissionRef]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Commission error:', err);
  } finally {
    client.release();
  }
}

module.exports = {
  processAgentCommission
};
