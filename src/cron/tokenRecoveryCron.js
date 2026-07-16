'use strict';

const db = require('../db');
const axios = require('axios');
const logger = require('../utils/logger');
const { emitEvent } = require('../realtime/bus');
const { sendSystemAlert } = require('../services/telegramService');

function startTokenRecoveryCron() {

  setInterval(async () => {
    try {
      const res = await db.query(`
        SELECT id, reference, user_id
        FROM transactions
        WHERE provider = 'vtpass'
          AND token IS NULL
          AND status = 'success'
          AND created_at > NOW() - INTERVAL '1 day'
        LIMIT 20
      `);

      for (const row of res.rows) {
        try {
          const response = await axios.post(
            process.env.VTPASS_QUERY_URL,
            { request_id: row.reference },
            {
              headers: {
                'api-key': process.env.VTPASS_API_KEY,
                'secret-key': process.env.VTPASS_SECRET_KEY
              }
            }
          );

          const body = response.data?.responseBody || {};

          const token =
            body?.token ||
            body?.Token ||
            body?.tokenNumber ||
            body?.PurchasedCode ||
            null;

          if (!token) continue;

          // ✅ UPDATE DATABASE
          await db.query(`
            UPDATE transactions
            SET token = $1,
                token_status = 'available',
                token_last_checked = NOW()
            WHERE id = $2
          `, [token, row.id]);

          logger.info({
            type: 'TOKEN_RECOVERED',
            reference: row.reference
          });

          // 🚀 REALTIME EVENT
          await emitEvent({
            type: 'transaction:token_ready',
            userId: row.user_id,
            payload: {
              reference: row.reference,
              token,
              tokenStatus: 'available'
            }
          });

          // 🔄 UPDATE WALLET UI
          await emitEvent({
            type: 'wallet:update',
            userId: row.user_id,
            payload: {
              type: 'transaction_updated',
              reference: row.reference
            }
          });

          // 📲 TELEGRAM ALERT (ADMIN)
          await sendSystemAlert(
            `⚡ TOKEN RECOVERED\nRef: ${row.reference}\nToken: ${token}`
          );

        } catch (innerErr) {
          logger.error({
            type: 'TOKEN_SINGLE_FAIL',
            reference: row.reference,
            error: innerErr.message
          });
        }
      }

      logger.info({
        type: 'TOKEN_BATCH_DONE',
        count: res.rows.length
      });

    } catch (err) {
      logger.error({
        type: 'TOKEN_CRON_ERROR',
        error: err.message
      });
    }
  }, 60000); // every 60 seconds

  logger.info({ type: 'TOKEN_CRON_STARTED' });
}

module.exports = {
  startTokenRecoveryCron
};
