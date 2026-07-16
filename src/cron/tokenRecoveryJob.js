const db = require('../db');
const axios = require('axios');
const logger = require('../utils/logger');

async function recoverElectricityToken(reference) {
  try {
    const txRes = await db.query(
      `SELECT * FROM transactions WHERE reference = $1 LIMIT 1`,
      [reference]
    );

    const tx = txRes.rows[0];
    if (!tx || tx.token) return;

    const res = await axios.post(process.env.VTPASS_QUERY_URL, {
      request_id: reference
    }, {
      headers: {
        'api-key': process.env.VTPASS_API_KEY,
        'secret-key': process.env.VTPASS_SECRET_KEY
      }
    });

    const body = res.data?.responseBody || {};

    const token =
      body?.token ||
      body?.Token ||
      body?.tokenNumber ||
      null;

    if (token) {
      await db.query(`
        UPDATE transactions
        SET token = $1,
            token_status = 'available',
            token_last_checked = NOW()
        WHERE reference = $2
      `, [token, reference]);

      logger.info({
        type: 'TOKEN_RECOVERED',
        reference
      });
    } else {
      await db.query(`
        UPDATE transactions
        SET token_last_checked = NOW()
        WHERE reference = $1
      `, [reference]);
    }

  } catch (err) {
    logger.error({
      type: 'TOKEN_RECOVERY_ERROR',
      reference,
      error: err.message
    });
  }
}

async function runTokenRecovery() {
  const res = await db.query(`
    SELECT reference
    FROM transactions
    WHERE provider = 'vtpass'
      AND token IS NULL
      AND status = 'success'
      AND created_at > NOW() - INTERVAL '1 day'
    LIMIT 20
  `);

  for (const row of res.rows) {
    await recoverElectricityToken(row.reference);
  }

  logger.info({
    type: 'TOKEN_RECOVERY_BATCH',
    count: res.rows.length
  });
}

module.exports = {
  runTokenRecovery
};
