'use strict';

const db = require('../../db');
const logger = require('../../utils/logger');
const { emitToUser } = require('../../realtime/socket');

const TELEGRAM_ENABLED =
  String(process.env.TELEGRAM_ENABLED || 'true').toLowerCase() === 'true';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;
const TELEGRAM_API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

function safeJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch (_) {
    return '{}';
  }
}

async function tableExists(tableName) {
  const result = await db.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
    ) AS exists
    `,
    [tableName]
  );

  return Boolean(result.rows[0]?.exists);
}

async function getUserById(userId) {
  const result = await db.query(
    `
    SELECT id, phone, telegram_chat_id, name, email
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function getListingForUpload(listingId) {
  const result = await db.query(
    `
    SELECT
      l.id,
      l.user_id,
      l.title,
      l.listing_type,
      l.mode,
      l.price_min,
      l.price_max,
      l.currency,
      l.location_text,
      u.telegram_chat_id,
      u.phone,
      u.name
    FROM market_listings l
    LEFT JOIN users u
      ON u.id = l.user_id
    WHERE l.id = $1
    LIMIT 1
    `,
    [listingId]
  );

  return result.rows[0] || null;
}

async function getMatchContext(matchCandidateId) {
  const result = await db.query(
    `
    SELECT
      mc.id AS match_candidate_id,
      mc.source_listing_id,
      mc.target_listing_id,
      mc.score,
      mc.rank_position,
      mc.status,
      mc.explanation,
      s.user_id AS source_owner_id,
      s.title AS source_title,
      s.listing_type AS source_listing_type,
      s.mode AS source_mode,
      s.location_text AS source_location_text,
      s.currency AS source_currency,
      t.user_id AS target_owner_id,
      t.title AS target_title,
      t.listing_type AS target_listing_type,
      t.mode AS target_mode,
      t.location_text AS target_location_text,
      t.currency AS target_currency
    FROM match_candidates mc
    INNER JOIN market_listings s
      ON s.id = mc.source_listing_id
    INNER JOIN market_listings t
      ON t.id = mc.target_listing_id
    WHERE mc.id = $1
    LIMIT 1
    `,
    [matchCandidateId]
  );

  return result.rows[0] || null;
}

async function createAppNotificationSafe({
  userId,
  type,
  title,
  body,
  payload
}) {
  const exists = await tableExists('app_notifications');
  if (!exists) {
    logger.warn({
      type: 'APP_NOTIFICATION_TABLE_MISSING',
      userId,
      notificationType: type
    });

    return null;
  }

  try {
    const result = await db.query(
      `
      INSERT INTO app_notifications (
        user_id,
        type,
        title,
        body,
        payload,
        is_read,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, false, NOW())
      RETURNING id, user_id, type, title, body, payload, is_read, created_at
      `,
      [userId, type, title, body, safeJson(payload)]
    );

    const row = result.rows[0] || null;

    if (row) {
      emitToUser(userId, 'notification:new', {
        id: row.id,
        userId: row.user_id,
        type: row.type,
        title: row.title,
        body: row.body,
        payload: row.payload || {},
        isRead: row.is_read,
        createdAt: row.created_at
      });

      const unreadCount = await getUnreadCountSafe(userId);
      emitToUser(userId, 'notification:unread_count_changed', {
        count: unreadCount
      });
    }

    return row;
  } catch (error) {
    logger.error({
      type: 'APP_NOTIFICATION_CREATE_FAILED',
      userId,
      notificationType: type,
      error: error.message,
      stack: error.stack
    });

    return null;
  }
}

async function getUnreadCountSafe(userId) {
  const exists = await tableExists('app_notifications');
  if (!exists) return 0;

  try {
    const result = await db.query(
      `
      SELECT COUNT(*)::int AS count
      FROM app_notifications
      WHERE user_id = $1
        AND is_read = false
      `,
      [userId]
    );

    return result.rows[0]?.count || 0;
  } catch (error) {
    logger.error({
      type: 'APP_NOTIFICATION_UNREAD_COUNT_FAILED',
      userId,
      error: error.message
    });

    return 0;
  }
}

async function logUserNotificationSafe({
  userId,
  sourceListingId = null,
  notificationType,
  channel = 'telegram',
  telegramChatId = null,
  messageText = null,
  deliveryStatus = 'failed',
  providerMessageId = null,
  errorText = null
}) {
  const exists = await tableExists('user_notifications');
  if (!exists) return null;

  try {
    const result = await db.query(
      `
      INSERT INTO user_notifications (
        user_id,
        source_listing_id,
        notification_type,
        channel,
        telegram_chat_id,
        message_text,
        delivery_status,
        provider_message_id,
        sent_at,
        failed_at,
        error_text,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        CASE WHEN $7 = 'sent' THEN NOW() ELSE NULL END,
        CASE WHEN $7 = 'failed' THEN NOW() ELSE NULL END,
        $9,
        NOW(),
        NOW()
      )
      RETURNING *
      `,
      [
        userId,
        sourceListingId,
        notificationType,
        channel,
        telegramChatId,
        messageText,
        deliveryStatus,
        providerMessageId,
        errorText
      ]
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error({
      type: 'USER_NOTIFICATION_LOG_FAILED',
      userId,
      notificationType,
      error: error.message
    });

    return null;
  }
}

async function findExistingMatchNotification({
  matchCandidateId,
  recipientId,
  provider
}) {
  const exists = await tableExists('match_notifications');
  if (!exists) return null;

  const result = await db.query(
    `
    SELECT *
    FROM match_notifications
    WHERE match_candidate_id = $1
      AND recipient_id = $2
      AND provider = $3
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [matchCandidateId, recipientId, provider]
  );

  return result.rows[0] || null;
}

async function logMatchNotificationSafe({
  matchCandidateId,
  recipientId,
  provider = 'telegram',
  channel = 'telegram',
  telegramChatId = null,
  messageText = null,
  deliveryStatus = 'failed',
  providerMessageId = null,
  errorText = null
}) {
  const exists = await tableExists('match_notifications');
  if (!exists) return null;

  try {
    const result = await db.query(
      `
      INSERT INTO match_notifications (
        match_candidate_id,
        recipient_id,
        provider,
        channel,
        telegram_chat_id,
        message_text,
        delivery_status,
        provider_message_id,
        sent_at,
        failed_at,
        error_text,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        CASE WHEN $7 = 'sent' THEN NOW() ELSE NULL END,
        CASE WHEN $7 = 'failed' THEN NOW() ELSE NULL END,
        $9,
        NOW(),
        NOW()
      )
      RETURNING *
      `,
      [
        matchCandidateId,
        recipientId,
        provider,
        channel,
        telegramChatId,
        messageText,
        deliveryStatus,
        providerMessageId,
        errorText
      ]
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error({
      type: 'MATCH_NOTIFICATION_LOG_FAILED',
      matchCandidateId,
      recipientId,
      provider,
      error: error.message
    });

    return null;
  }
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_ENABLED) {
    throw new Error('telegram disabled');
  }

  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('telegram bot token missing');
  }

  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || 'telegram send failed');
  }

  return {
    providerMessageId: String(data?.result?.message_id || '')
  };
}

async function sendTelegramOptional({
  recipient,
  text,
  notificationType,
  sourceListingId = null,
  matchCandidateId = null,
  provider = 'telegram',
  dedupeMatchNotification = false
}) {
  if (!recipient?.id) {
    return {
      ok: false,
      skipped: true,
      reason: 'recipient_missing'
    };
  }

  if (!recipient.telegram_chat_id) {
    logger.warn({
      type: 'TELEGRAM_SKIPPED_NO_CHAT_ID',
      userId: recipient.id,
      notificationType,
      sourceListingId,
      matchCandidateId
    });

    if (matchCandidateId) {
      await logMatchNotificationSafe({
        matchCandidateId,
        recipientId: recipient.id,
        provider,
        channel: 'telegram',
        telegramChatId: null,
        messageText: text,
        deliveryStatus: 'failed',
        errorText: 'recipient has no telegram_chat_id'
      });
    } else {
      await logUserNotificationSafe({
        userId: recipient.id,
        sourceListingId,
        notificationType,
        channel: 'telegram',
        telegramChatId: null,
        messageText: text,
        deliveryStatus: 'failed',
        errorText: 'recipient has no telegram_chat_id'
      });
    }

    return {
      ok: false,
      skipped: true,
      reason: 'no_telegram_chat_id'
    };
  }

  if (dedupeMatchNotification && matchCandidateId) {
    const existing = await findExistingMatchNotification({
      matchCandidateId,
      recipientId: recipient.id,
      provider
    });

    if (existing) {
      logger.info({
        type: 'TELEGRAM_MATCH_DEDUPED',
        matchCandidateId,
        recipientId: recipient.id,
        provider
      });

      return {
        ok: true,
        skipped: true,
        reason: 'deduped'
      };
    }
  }

  logger.info({
    type: 'TELEGRAM_SEND_ATTEMPT',
    userId: recipient.id,
    notificationType,
    provider,
    telegramChatId: recipient.telegram_chat_id,
    sourceListingId,
    matchCandidateId
  });

  try {
    const sent = await sendTelegramMessage(recipient.telegram_chat_id, text);

    if (matchCandidateId) {
      await logMatchNotificationSafe({
        matchCandidateId,
        recipientId: recipient.id,
        provider,
        channel: 'telegram',
        telegramChatId: recipient.telegram_chat_id,
        messageText: text,
        deliveryStatus: 'sent',
        providerMessageId: sent.providerMessageId,
        errorText: null
      });
    } else {
      await logUserNotificationSafe({
        userId: recipient.id,
        sourceListingId,
        notificationType,
        channel: 'telegram',
        telegramChatId: recipient.telegram_chat_id,
        messageText: text,
        deliveryStatus: 'sent',
        providerMessageId: sent.providerMessageId,
        errorText: null
      });
    }

    logger.info({
      type: 'TELEGRAM_SEND_SUCCESS',
      userId: recipient.id,
      notificationType,
      provider,
      providerMessageId: sent.providerMessageId
    });

    return {
      ok: true,
      providerMessageId: sent.providerMessageId
    };
  } catch (error) {
    if (matchCandidateId) {
      await logMatchNotificationSafe({
        matchCandidateId,
        recipientId: recipient.id,
        provider,
        channel: 'telegram',
        telegramChatId: recipient.telegram_chat_id,
        messageText: text,
        deliveryStatus: 'failed',
        errorText: error.message
      });
    } else {
      await logUserNotificationSafe({
        userId: recipient.id,
        sourceListingId,
        notificationType,
        channel: 'telegram',
        telegramChatId: recipient.telegram_chat_id,
        messageText: text,
        deliveryStatus: 'failed',
        errorText: error.message
      });
    }

    logger.error({
      type: 'TELEGRAM_SEND_FAILED',
      userId: recipient.id,
      notificationType,
      provider,
      error: error.message,
      stack: error.stack
    });

    return {
      ok: false,
      error: error.message
    };
  }
}

async function notifyListingUploadSuccess(listingId) {
  const listing = await getListingForUpload(listingId);
  if (!listing) {
    return {
      ok: false,
      error: 'listing not found'
    };
  }

  const appNotification = await createAppNotificationSafe({
    userId: listing.user_id,
    type: 'listing_uploaded',
    title: 'Listing Created Successfully',
    body: `Your listing "${listing.title}" is now live.`,
    payload: {
      listingId: listing.id,
      listingType: listing.listing_type || listing.mode || null
    }
  });

  const recipient = {
    id: listing.user_id,
    telegram_chat_id: listing.telegram_chat_id,
    phone: listing.phone,
    name: listing.name
  };

  const telegramText =
    `✅ <b>Your listing is live</b>\n\n` +
    `<b>${listing.title}</b>\n` +
    `${listing.location_text ? `📍 ${listing.location_text}\n` : ''}` +
    `${listing.currency ? `💱 ${listing.currency}\n` : ''}` +
    `You can now receive matches inside ProxiNG.`;

  const telegram = await sendTelegramOptional({
    recipient,
    text: telegramText,
    notificationType: 'listing_upload_success',
    sourceListingId: listing.id,
    provider: 'listing_upload_success'
  });

  return {
    ok: true,
    listingId: listing.id,
    appNotificationId: appNotification?.id || null,
    telegram
  };
}

function buildMatchMessages(context, dealRoomId) {
  const sourceTitle = context.source_title || 'your listing';
  const targetTitle = context.target_title || 'a matching listing';

  return {
    sourceOwner: {
      title: 'Match found',
      body: `A strong match was found for "${sourceTitle}". Open the deal room to continue.`,
      telegram:
        `🎯 <b>Match found</b>\n\n` +
        `Your listing: <b>${sourceTitle}</b>\n` +
        `Matched with: <b>${targetTitle}</b>\n` +
        `${dealRoomId ? `Deal room is ready inside ProxiNG.\n` : ''}` +
        `Continue negotiation in-app.`
    },
    targetOwner: {
      title: 'Match found',
      body: `A strong match was found for "${targetTitle}". Open the deal room to continue.`,
      telegram:
        `🎯 <b>Match found</b>\n\n` +
        `Your listing: <b>${targetTitle}</b>\n` +
        `Matched with: <b>${sourceTitle}</b>\n` +
        `${dealRoomId ? `Deal room is ready inside ProxiNG.\n` : ''}` +
        `Continue negotiation in-app.`
    }
  };
}

async function notifyMatchFound({ matchCandidateId, dealRoomId = null }) {
  const context = await getMatchContext(matchCandidateId);
  if (!context) {
    return {
      ok: false,
      error: 'match context not found'
    };
  }

  const sourceOwner = await getUserById(context.source_owner_id);
  const targetOwner = await getUserById(context.target_owner_id);

  const messages = buildMatchMessages(context, dealRoomId);

  const sourceApp = sourceOwner
    ? await createAppNotificationSafe({
        userId: sourceOwner.id,
        type: 'match_found',
        title: messages.sourceOwner.title,
        body: messages.sourceOwner.body,
        payload: {
          candidateId: context.match_candidate_id,
          dealRoomId,
          sourceListingId: context.source_listing_id,
          targetListingId: context.target_listing_id,
          role: 'source_owner'
        }
      })
    : null;

  const targetApp = targetOwner
    ? await createAppNotificationSafe({
        userId: targetOwner.id,
        type: 'match_found',
        title: messages.targetOwner.title,
        body: messages.targetOwner.body,
        payload: {
          candidateId: context.match_candidate_id,
          dealRoomId,
          sourceListingId: context.source_listing_id,
          targetListingId: context.target_listing_id,
          role: 'target_owner'
        }
      })
    : null;

  if (sourceOwner) {
    emitToUser(sourceOwner.id, 'match:found', {
      candidateId: context.match_candidate_id,
      dealRoomId,
      notification: sourceApp
        ? {
            id: sourceApp.id,
            userId: sourceApp.user_id,
            type: sourceApp.type,
            title: sourceApp.title,
            body: sourceApp.body,
            payload: sourceApp.payload || {},
            isRead: sourceApp.is_read,
            createdAt: sourceApp.created_at
          }
        : null
    });
  }

  if (targetOwner) {
    emitToUser(targetOwner.id, 'match:found', {
      candidateId: context.match_candidate_id,
      dealRoomId,
      notification: targetApp
        ? {
            id: targetApp.id,
            userId: targetApp.user_id,
            type: targetApp.type,
            title: targetApp.title,
            body: targetApp.body,
            payload: targetApp.payload || {},
            isRead: targetApp.is_read,
            createdAt: targetApp.created_at
          }
        : null
    });
  }

  if (dealRoomId) {
    if (sourceOwner) {
      emitToUser(sourceOwner.id, 'deal_room:created', {
        dealRoomId,
        candidateId: context.match_candidate_id
      });
    }

    if (targetOwner) {
      emitToUser(targetOwner.id, 'deal_room:created', {
        dealRoomId,
        candidateId: context.match_candidate_id
      });
    }
  }

  const sourceTelegram = sourceOwner
    ? await sendTelegramOptional({
        recipient: sourceOwner,
        text: messages.sourceOwner.telegram,
        notificationType: 'match_source_owner',
        sourceListingId: context.source_listing_id,
        matchCandidateId: context.match_candidate_id,
        provider: 'match_source_owner',
        dedupeMatchNotification: true
      })
    : {
        ok: false,
        skipped: true,
        reason: 'source_owner_missing'
      };

  const targetTelegram = targetOwner
    ? await sendTelegramOptional({
        recipient: targetOwner,
        text: messages.targetOwner.telegram,
        notificationType: 'match_target_owner',
        sourceListingId: context.target_listing_id,
        matchCandidateId: context.match_candidate_id,
        provider: 'match_target_owner',
        dedupeMatchNotification: true
      })
    : {
        ok: false,
        skipped: true,
        reason: 'target_owner_missing'
      };

  return {
    ok: true,
    matchCandidateId: context.match_candidate_id,
    dealRoomId,
    count: [sourceOwner, targetOwner].filter(Boolean).length,
    sourceOwner: {
      userId: sourceOwner?.id || null,
      appNotificationId: sourceApp?.id || null,
      telegram: sourceTelegram
    },
    targetOwner: {
      userId: targetOwner?.id || null,
      appNotificationId: targetApp?.id || null,
      telegram: targetTelegram
    }
  };
}

async function notifyNoMatchHint(listingId) {
  const listing = await getListingForUpload(listingId);
  if (!listing) {
    return {
      ok: false,
      error: 'listing not found'
    };
  }

  const appNotification = await createAppNotificationSafe({
    userId: listing.user_id,
    type: 'no_match_yet',
    title: 'We are still searching',
    body: `We’re still finding the best match for "${listing.title}".`,
    payload: {
      listingId: listing.id
    }
  });

  const recipient = {
    id: listing.user_id,
    telegram_chat_id: listing.telegram_chat_id,
    phone: listing.phone,
    name: listing.name
  };

  const telegramText =
    `🔎 <b>We’re still searching</b>\n\n` +
    `We’re still finding the best match for <b>${listing.title}</b>.\n` +
    `You’ll be notified once a strong match is ready.`;

  const telegram = await sendTelegramOptional({
    recipient,
    text: telegramText,
    notificationType: 'no_match_hint',
    sourceListingId: listing.id,
    provider: 'no_match_hint'
  });

  return {
    ok: true,
    listingId: listing.id,
    appNotificationId: appNotification?.id || null,
    telegram
  };
}

module.exports = {
  notifyListingUploadSuccess,
  notifyMatchFound,
  notifyNoMatchHint
};
