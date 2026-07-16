const db = require('../db');
const { creditWallet } = require('../services/wallet.service');

async function reconcilePaystackPayment(paymentData) {
  const { userId, amount, reference } = paymentData;

  if (!userId || !amount || !reference) {
    throw new Error('Invalid Paystack payload');
  }

  const exists = await db.query(
    `SELECT id FROM ledger_entries WHERE reference = $1`,
    [`paystack_${reference}`]
  );

  if (exists.rows.length > 0) {
    return { alreadyProcessed: true };
  }

  await creditWallet(userId, amount, `paystack_${reference}`);

  await db.query(
    `INSERT INTO transactions (user_id, type, amount, reference, status)
     VALUES ($1, 'credit', $2, $3, 'success')`,
    [userId, amount, `paystack_${reference}`]
  );

  return { success: true };
}

module.exports = { reconcilePaystackPayment };
