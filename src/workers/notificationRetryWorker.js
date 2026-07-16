'use strict';

const db = require('../db');
const logger = require('../util/logger');
const { sendNotification } = require('../services/notifications');

const POLL_MS = Number(process.env.NOTIFICATION_RETRY_POLL_MS || 5000);

async function retryFailedUserNotifications() {
  const result = await db.query(
    `
    SELECT *
    FROM user_notifications
    WHERE channel = 'telegram'
      AND delivery_status = 'failed'
      AND failed_at <= NOW() - INTERVAL '5 minutes'
    ORDER BY failed_at ASC
    LIMIT 20
    `
  );

  for (const row of result.rows) {
    if (!row.telegram_chat_id) continue;

    try {
      const sent = await sendNotification({
        channel: 'telegram',
        to: row.telegram_chat_id,
        text: row.message_text,
        parseMode: 'HTML'
      });

      await db.query(
        `
        UPDATE user_notifications
        SET delivery_status = 'sent',
            provider_message_id = $2,
            sent_at = NOW(),
            error_text = NULL,
            updated_at = NOW()
        WHERE id = $1
        `,
        [row.id, sent?.providerMessageId || null]
      );

      logger.info({
        type: 'USER_NOTIFICATION_RETRY_SENT',
        notificationId: row.id,
        userId: row.user_id
      });
    } catch (error) {
      await db.query(
        `
        UPDATE user_notifications
        SET failed_at = NOW(),
            error_text = $2,
            updated_at = NOW()
        WHERE id = $1
        `,
        [row.id, error.message]
      );

      logger.error({
        type: 'USER_NOTIFICATION_RETRY_FAILED',
        notificationId: row.id,
        userId: row.user_id,
        error: error.message
      });
    }
  }
}

async function retryFailedMatchNotifications() {
  const result = await db.query(
    `
    SELECT *
    FROM match_notifications
    WHERE channel = 'telegram'
      AND delivery_status = 'failed'
      AND failed_at <= NOW() - INTERVAL '5 minutes'
    ORDER BY failed_at ASC
    LIMIT 20
    `
  );

  for (const row of result.rows) {
    if (!row.telegram_chat_id) continue;

    try {
      const sent = await sendNotification({
        channel: 'telegram',
        to: row.telegram_chat_id,
        text: row.message_text,
        parseMode: 'HTML'
      });

      await db.query(
        `
        UPDATE match_notifications
        SET delivery_status = 'sent',
            provider_message_id = $2,
            sent_at = NOW(),
            error_text = NULL,
            updated_at = NOW()
        WHERE id = $1
        `,
        [row.id, sent?.providerMessageId || null]
      );

      logger.info({
        type: 'MATCH_NOTIFICATION_RETRY_SENT',
        notificationId: row.id,
        recipientId: row.recipient_id
      });
    } catch (error) {
      await db.query(
        `
        UPDATE match_notifications
        SET failed_at = NOW(),
            error_text = $2,
            updated_at = NOW()
        WHERE id = $1
        `,
        [row.id, error.message]
      );

      logger.error({
        type: 'MATCH_NOTIFICATION_RETRY_FAILED',
        notificationId: row.id,
        recipientId: row.recipient_id,
        error: error.message
      });
    }
  }
}

async function loop() {
  logger.info({ type: 'NOTIFICATION_RETRY_WORKER_STARTED' });

  while (true) {
    try {
      await retryFailedUserNotifications();
      await retryFailedMatchNotifications();
    } catch (error) {
      logger.error({
        type: 'NOTIFICATION_RETRY_WORKER_LOOP_FAILED',
        error: error.message,
        stack: error.stack
      });
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

loop().catch((error) => {
  logger.error({
    type: 'NOTIFICATION_RETRY_WORKER_FATAL',
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});
