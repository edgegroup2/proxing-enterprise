const db = require("../db"); // your pg pool
const logger = require("../logger");

/**
 * Create a transaction safely
 * This runs BEFORE money is credited
 */
async function createTransaction({
  userId,
  reference,
  amount,
  channel,   // paystack | monnify | vtpass
  type,      // wallet_funding | airtime | data | tv | electricity
  provider,  // paystack | monnify | vtpass
  meta = {},
}) {
  try {
    const { rows } = await db.query(
      `
      INSERT INTO transactions
        (user_id, reference, amount, channel, type, status, provider, meta)
      VALUES
        ($1, $2, $3, $4, $5, 'pending', $6, $7)
      ON CONFLICT (reference) DO NOTHING
      RETURNING *
      `,
      [userId, reference, amount, channel, type, provider, meta]
    );

    if (!rows.length) {
      logger.warn({ reference }, "Transaction already exists");
      return null;
    }

    logger.info({ reference, amount, channel }, "Transaction created");
    return rows[0];
  } catch (err) {
    logger.error(err, "Failed to create transaction");
    throw err;
  }
}

/**
 * Mark transaction as successful
 */
async function markTransactionSuccess(reference) {
  await db.query(
    `
    UPDATE transactions
    SET status = 'success'
    WHERE reference = $1
    `,
    [reference]
  );

  logger.info({ reference }, "Transaction marked successful");
}

/**
 * Mark transaction as failed
 */
async function markTransactionFailed(reference, reason = {}) {
  await db.query(
    `
    UPDATE transactions
    SET status = 'failed', meta = meta || $2
    WHERE reference = $1
    `,
    [reference, reason]
  );

  logger.warn({ reference }, "Transaction marked failed");
}

/**
 * Check if transaction already succeeded
 */
async function isTransactionSuccessful(reference) {
  const { rows } = await db.query(
    `
    SELECT 1 FROM transactions
    WHERE reference = $1 AND status = 'success'
    `,
    [reference]
  );

  return rows.length > 0;
}

module.exports = {
  createTransaction,
  markTransactionSuccess,
  markTransactionFailed,
  isTransactionSuccessful,
};
