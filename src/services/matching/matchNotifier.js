'use strict';

const db = require('../../db');
const logger = require('../../util/logger');
const {
  sendTelegramMessage,
  buildMatchAlertMessage
} = require('../telegramNotifier');

async function getCandidateById(matchCandidateId) {
  const result = await db.query(
    `
    SELECT
      mc.*,
      s.id AS source_id,
      s.user_id AS source_user_id,
      s.title AS source_title,
      s.category AS source_category,
      s.subcategory AS source_subcategory,
      s.description AS source_description,
      s.location_text AS source_location_text,
      s.price_min AS source_price_min,
      s.price_max AS source_price_max,
      s.currency AS source_currency,
      s.mode AS source_mode,
      s.listing_type AS source_listing_type,

      t.id AS target_id,
      t.user_id AS target_user_id,
      t.title AS target_title,
      t.category AS target_category,
      t.subcategory AS target_subcategory,
      t.description AS target_description,
      t.location_text AS target_location_text,
      t.price_min AS target_price_min,
      t.price_max AS target_price_max,
      t.currency AS target_currency,
      t.mode AS target_mode,
      t.listing_type AS target_listing_type
    FROM match_candidates mc
    INNER JOIN market_listings s ON s.id = mc.source_listing_id
    INNER JOIN market_listings t ON t.id = mc.target_listing_id
    WHERE mc.id = $1
    LIMIT 1
    `,
    [matchCandidateId]
  );

  return result.rows[0] || null;
}

async function getUserById(userId) {
  const result = await db.query(
    `
    SELECT id,  name, phone, email, telegram_chat_id
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

function pickUserName(user) {
  return (
    user?.name ||
    user?.phone ||
    user?.email ||
    'ProxiNG user'
  );
}

async function createNotificationRecord({
  matchCandidateId,
  recipientUserId,
  telegramChatId,
  messageText
}) {
  const result = await db.query(
    `
    INSERT INTO match_notifications (
      match_candidate_id,
      recipient_user_id,
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
      $1,$2,'telegram',$3,$4,'pending',NULL,NULL,NULL,NULL,NOW(),NOW()
    )
    RETURNING *
    `,
    [matchCandidateId, recipientUserId, telegramChatId || null, messageText]
  );

  return result.rows[0];
}

async function markNotificationSent(notificationId, providerMessageId = null) {
  await db.query(
    `
    UPDATE match_notifications
    SET delivery_status = 'sent',
        provider_message_id = $2,
        sent_at = NOW(),
        failed_at = NULL,
        error_text = NULL,
        updated_at = NOW()
    WHERE id = $1
    `,
    [notificationId, providerMessageId]
  );
}

async function markNotificationFailed(notificationId, errorText) {
  await db.query(
    `
    UPDATE match_notifications
    SET delivery_status = 'failed',
        failed_at = NOW(),
        error_text = $2,
        updated_at = NOW()
    WHERE id = $1
    `,
    [notificationId, errorText || 'unknown notification error']
  );
}

async function alreadyNotified(matchCandidateId, recipientUserId) {
  const result = await db.query(
    `
    SELECT id
    FROM match_notifications
    WHERE match_candidate_id = $1
      AND recipient_user_id = $2
      AND delivery_status IN ('pending', 'sent')
    LIMIT 1
    `,
    [matchCandidateId, recipientUserId]
  );

  return Boolean(result.rows[0]);
}

async function notifyMatchCandidate(matchCandidateId) {
  const candidate = await getCandidateById(matchCandidateId);

  if (!candidate) {
    throw new Error('match candidate not found');
  }

  const recipientUser = await getUserById(candidate.target_user_id);
  if (!recipientUser) {
    throw new Error('recipient user not found');
  }

  if (await alreadyNotified(matchCandidateId, recipientUser.id)) {
    return {
      ok: true,
      skipped: true,
      reason: 'already-notified'
    };
  }

  const sourceListing = {
    id: candidate.source_id,
    user_id: candidate.source_user_id,
    title: candidate.source_title,
    category: candidate.source_category,
    subcategory: candidate.source_subcategory,
    description: candidate.source_description,
    location_text: candidate.source_location_text,
    price_min: candidate.source_price_min,
    price_max: candidate.source_price_max,
    currency: candidate.source_currency,
    mode: candidate.source_mode,
    listing_type: candidate.source_listing_type
  };

  const targetListing = {
    id: candidate.target_id,
    user_id: candidate.target_user_id,
    title: candidate.target_title,
    category: candidate.target_category,
    subcategory: candidate.target_subcategory,
    description: candidate.target_description,
    location_text: candidate.target_location_text,
    price_min: candidate.target_price_min,
    price_max: candidate.target_price_max,
    currency: candidate.target_currency,
    mode: candidate.target_mode,
    listing_type: candidate.target_listing_type
  };

  const breakdown = (() => {
    try {
      return typeof candidate.score_breakdown === 'object'
        ? candidate.score_breakdown
        : JSON.parse(candidate.score_breakdown || '{}');
    } catch (_) {
      return {};
    }
  })();

  const messageText = buildMatchAlertMessage({
    recipientName: pickUserName(recipientUser),
    sourceListing,
    targetListing,
    score: candidate.score,
    explanation: breakdown?.explanation || candidate.explanation || ''
  });

  const notification = await createNotificationRecord({
    matchCandidateId,
    recipientUserId: recipientUser.id,
    telegramChatId: recipientUser.telegram_chat_id || null,
    messageText
  });

  if (!recipientUser.telegram_chat_id) {
    await markNotificationFailed(notification.id, 'recipient has no telegram_chat_id');

    logger.warn({
      type: 'MATCH_NOTIFY_SKIPPED_NO_CHAT_ID',
      matchCandidateId,
      recipientUserId: recipientUser.id
    });

    return {
      ok: false,
      skipped: true,
      reason: 'missing-chat-id',
      notificationId: notification.id
    };
  }

  try {
    const telegramResponse = await sendTelegramMessage(
      recipientUser.telegram_chat_id,
      messageText
    );

    await markNotificationSent(
      notification.id,
      telegramResponse?.message_id ? String(telegramResponse.message_id) : null
    );

    logger.info({
      type: 'MATCH_NOTIFY_SENT',
      matchCandidateId,
      recipientUserId: recipientUser.id,
      notificationId: notification.id
    });

    return {
      ok: true,
      notificationId: notification.id
    };
  } catch (error) {
    await markNotificationFailed(notification.id, error.message);

    logger.error({
      type: 'MATCH_NOTIFY_FAILED',
      matchCandidateId,
      recipientUserId: recipientUser.id,
      notificationId: notification.id,
      error: error.message
    });

    return {
      ok: false,
      notificationId: notification.id,
      error: error.message
    };
  }
}

async function notifyTopMatchesForListing(sourceListingId, limit = 5) {
  const result = await db.query(
    `
    SELECT id
    FROM match_candidates
    WHERE source_listing_id = $1
      AND status = 'suggested'
    ORDER BY rank_position ASC, score DESC
    LIMIT $2
    `,
    [sourceListingId, limit]
  );

  let count = 0;

  for (const row of result.rows) {
    const sent = await notifyMatchCandidate(row.id);
    if (sent?.ok) count += 1;
  }

  return {
    ok: true,
    count
  };
}

module.exports = {
  notifyMatchCandidate,
  notifyTopMatchesForListing
};
