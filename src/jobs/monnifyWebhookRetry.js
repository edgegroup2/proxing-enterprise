'use strict';

const db = require('../db');
const logger = require('../utils/logger');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function processOneEvent(row) {
  const paymentReference = row.payment_reference;
  const destAccountNumber = row.dest_account_number;
  const amount = Number(row.amount || 0);

  // resolve user
  const userRes = await db.query(`
    SELECT user_id
    FROM virtual_accounts
    WHERE provider = 'monnify'
      AND account_number = $1
    LIMIT 1
  `, [destAccountNumber]);

  const userId = userRes.rows[0]?.user_id;

  if (!userId) {
    logger.warn({
      type: 'MONNIFY_RETRY_STILL_UNRESOLVED',
      paymentReference,
      destAccountNumber
    });
    return;
  }

  // credit (idempotent via unique(reference))
  try {
    await db.query(`
      INSERT INTO transactions (user_id, amount, reference, provider)
      VALUES ($1, $2, $3, 'monnify')
    `, [userId, amount, paymentReference]);
  } catch (e) {
    // if reference unique violation, treat as already credited
    if (e?.code !== '23505') throw e;
  }

  await db.query(`
    UPDATE monnify_webhook_events
    SET processed_at = now(),
        resolved_user_id = $2,
        credit_status = 'credited'
    WHERE payment_reference = $1
  `, [paymentReference, userId]);

  logger.info({
    type: 'MONNIFY_RETRY_CREDITED',
    paymentReference,
    userId,
    amount
  });
}

function startMonnifyRetryJob() {
  const intervalMs = 60 * 1000;

  (async function loop() {
    while (true) {
      try {
        const pending = await db.query(`
          SELECT payment_reference, dest_account_number, amount
          FROM monnify_webhook_events
          WHERE processed_at IS NULL
          ORDER BY created_at ASC
          LIMIT 20
        `);

        for (const row of pending.rows) {
          await processOneEvent(row);
        }

      } catch (err) {
        logger.error({
          type: 'MONNIFY_RETRY_JOB_ERROR',
          error: err.message,
          stack: err.stack
        });
      }

      await sleep(intervalMs);
    }
  })();
}

module.exports = { startMonnifyRetryJob };
