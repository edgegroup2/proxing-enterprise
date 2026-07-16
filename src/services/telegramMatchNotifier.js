'use strict';

const db = require('../db');
const logger = require('../util/logger');

let telegramNotifier = null;
try {
  telegramNotifier = require('./telegramNotifier');
} catch (_) {
  telegramNotifier = null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toMoney(value, currency = 'NGN') {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Price on request';

  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: currency || 'NGN',
      maximumFractionDigits: 0
    }).format(n);
  } catch (_) {
    return `${currency || 'NGN'} ${n}`;
  }
}

function pickPrice(listing) {
  const min = Number(listing?.price_min);
  const max = Number(listing?.price_max);
  const currency = listing?.currency || 'NGN';

  if (Number.isFinite(min) && Number.isFinite(max)) {
    if (min === max) return toMoney(min, currency);
    return `${toMoney(min, currency)} - ${toMoney(max, currency)}`;
  }

  if (Number.isFinite(min)) return toMoney(min, currency);
  if (Number.isFinite(max)) return toMoney(max, currency);

  return 'Price on request';
}

async function getUserById(userId) {
  const result = await db.query(
    `
    SELECT id, name, phone, email, telegram_chat_id
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function getListingById(listingId) {
  const result = await db.query(
    `
    SELECT *
    FROM market_listings
    WHERE id = $1
    LIMIT 1
    `,
    [listingId]
  );

  return result.rows[0] || null;
}

function pickUserName(user) {
  return (
    user?.name ||
    user?.phone ||
    user?.email ||
    'ProxiNG User'
  );
}

function buildTelegramMatchMessage({ recipient, sourceListing, targetListing, score }) {
  const recipientName = escapeHtml(pickUserName(recipient));
  const title = escapeHtml(
    targetListing?.title || targetListing?.category || 'Matched listing'
  );
  const category = escapeHtml(targetListing?.category || '-');
  const subcategory = escapeHtml(targetListing?.subcategory || '-');
  const mode = escapeHtml(targetListing?.mode || '-');
  const location = escapeHtml(targetListing?.location_text || 'Unspecified location');
  const price = escapeHtml(pickPrice(targetListing));
  const triggerTitle = escapeHtml(
    sourceListing?.title || sourceListing?.category || 'Your listing'
  );
  const scoreText = Number.isFinite(Number(score)) ? String(score) : '-';

  return [
    `👋 Hello <b>${recipientName}</b>,`,
    '',
    `🤝 <b>New ProxiNG Match Found</b>`,
    '',
    `A listing relevant to your request is now available.`,
    '',
    `📦 <b>Item:</b> ${title}`,
    `🗂 <b>Category:</b> ${category}`,
    `🏷 <b>Subcategory:</b> ${subcategory}`,
    `🔁 <b>Type:</b> ${mode}`,
    `📍 <b>Location:</b> ${location}`,
    `💰 <b>Price:</b> ${price}`,
    `📊 <b>Match score:</b> ${escapeHtml(scoreText)}`,
    '',
    `🔔 <b>Triggered by:</b> ${triggerTitle}`,
    '',
    `Open ProxiNG to review and continue safely inside the app.`
  ].join('\n');
}

async function sendTelegram(chatId, text) {
  if (!chatId) {
    throw new Error('missing telegram chat id');
  }

  if (
    !telegramNotifier ||
    typeof telegramNotifier.sendTelegramMessage !== 'function'
  ) {
    throw new Error('telegram notifier not available');
  }

  return telegramNotifier.sendTelegramMessage(chatId, text, {
    parse_mode: 'HTML'
  });
}

async function createNotification({
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
      created_at,
      updated_at
    )
    VALUES ($1, $2, 'telegram', $3, $4, 'pending', NOW(), NOW())
    RETURNING *
    `,
    [matchCandidateId, recipientUserId, telegramChatId || null, messageText]
  );

  return result.rows[0];
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

async function notifyMatchCandidate(matchCandidateId) {
  const candidateResult = await db.query(
    `
    SELECT *
    FROM match_candidates
    WHERE id = $1
    LIMIT 1
    `,
    [matchCandidateId]
  );

  const candidate = candidateResult.rows[0];
  if (!candidate) {
    throw new Error('match candidate not found');
  }

  const sourceListing = await getListingById(candidate.source_listing_id);
  const targetListing = await getListingById(candidate.target_listing_id);

  if (!sourceListing || !targetListing) {
    throw new Error('listing data missing for match candidate');
  }

  const recipient = await getUserById(targetListing.user_id);
  if (!recipient) {
    throw new Error('recipient user not found');
  }

  const messageText = buildTelegramMatchMessage({
    recipient,
    sourceListing,
    targetListing,
    score: candidate.score
  });

  const notification = await createNotification({
    matchCandidateId,
    recipientUserId: recipient.id,
    telegramChatId: recipient.telegram_chat_id || null,
    messageText
  });

  if (!recipient.telegram_chat_id) {
    await markNotificationFailed(notification.id, 'recipient has no telegram_chat_id');

    logger.warn({
      type: 'MATCH_TELEGRAM_SKIPPED',
      matchCandidateId,
      recipientUserId: recipient.id,
      reason: 'missing-chat-id'
    });

    return {
      ok: false,
      reason: 'missing-chat-id',
      notificationId: notification.id
    };
  }

  try {
    const telegramResponse = await sendTelegram(recipient.telegram_chat_id, messageText);

    await markNotificationSent(
      notification.id,
      telegramResponse?.message_id
        ? String(telegramResponse.message_id)
        : null
    );

    logger.info({
      type: 'MATCH_TELEGRAM_SENT',
      matchCandidateId,
      recipientUserId: recipient.id,
      notificationId: notification.id
    });

    return {
      ok: true,
      notificationId: notification.id
    };
  } catch (err) {
    await markNotificationFailed(notification.id, err.message);

    logger.error({
      type: 'MATCH_TELEGRAM_FAILED',
      matchCandidateId,
      recipientUserId: recipient.id,
      notificationId: notification.id,
      error: err.message
    });

    return {
      ok: false,
      notificationId: notification.id,
      error: err.message
    };
  }
}

module.exports = {
  notifyMatchCandidate,
  buildTelegramMatchMessage
};
