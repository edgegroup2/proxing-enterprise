'use strict';

const logger = require('../util/logger');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
const TELEGRAM_ENABLED = String(process.env.TELEGRAM_ENABLED || '').toLowerCase() === 'true';

function isTelegramEnabled() {
  return Boolean(TELEGRAM_ENABLED && TELEGRAM_BOT_TOKEN);
}

function buildTelegramUrl(method) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }

  return `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/${method}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(value, currency = 'NGN') {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return 'Price on request';
  }

  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: currency || 'NGN',
      maximumFractionDigits: 0
    }).format(amount);
  } catch (_) {
    return `${currency || 'NGN'} ${amount}`;
  }
}

function pickDisplayPrice(listing) {
  const min = Number(listing?.price_min);
  const max = Number(listing?.price_max);
  const currency = listing?.currency || 'NGN';

  if (Number.isFinite(min) && Number.isFinite(max)) {
    if (min === max) {
      return formatMoney(min, currency);
    }

    return `${formatMoney(min, currency)} - ${formatMoney(max, currency)}`;
  }

  if (Number.isFinite(min)) {
    return formatMoney(min, currency);
  }

  if (Number.isFinite(max)) {
    return formatMoney(max, currency);
  }

  return 'Price on request';
}

function normalizeListingType(listing) {
  const raw = String(listing?.listing_type || listing?.mode || '').trim().toLowerCase();

  if (raw === 'seeking') return 'seeking';
  if (raw === 'offering') return 'offering';

  return raw || '-';
}

function pickRecipientName(user) {
  return (
    user?.name ||
    user?.phone ||
    user?.email ||
    'there'
  );
}

function buildMatchAlertMessage({
  recipientName,
  sourceListing,
  targetListing,
  score,
  explanation
}) {
  const safeRecipient = escapeHtml(recipientName || 'there');
  const safeSourceTitle = escapeHtml(
    sourceListing?.title || sourceListing?.category || 'Your listing'
  );
  const safeTargetTitle = escapeHtml(
    targetListing?.title || targetListing?.category || 'Matched listing'
  );
  const safeCategory = escapeHtml(targetListing?.category || '-');
  const safeSubcategory = escapeHtml(targetListing?.subcategory || '-');
  const safeLocation = escapeHtml(targetListing?.location_text || 'Unspecified');
  const safeType = escapeHtml(normalizeListingType(targetListing));
  const safePrice = escapeHtml(pickDisplayPrice(targetListing));
  const safeScore = escapeHtml(String(score ?? '-'));
  const safeExplanation = escapeHtml(explanation || '');

  return [
    `👋 Hello <b>${safeRecipient}</b>,`,
    '',
    `🤝 <b>New Match Found on ProxiNG</b>`,
    '',
    `Your listing may match with:`,
    `📦 <b>Item:</b> ${safeTargetTitle}`,
    `🗂 <b>Category:</b> ${safeCategory}`,
    `🏷 <b>Subcategory:</b> ${safeSubcategory}`,
    `🔁 <b>Type:</b> ${safeType}`,
    `📍 <b>Location:</b> ${safeLocation}`,
    `💰 <b>Price:</b> ${safePrice}`,
    `📊 <b>Match Score:</b> ${safeScore}`,
    '',
    `🔔 <b>Triggered by:</b> ${safeSourceTitle}`,
    safeExplanation ? `🧠 <b>Why matched:</b> ${safeExplanation}` : '',
    '',
    `Open ProxiNG to review and continue safely inside the app.`
  ]
    .filter(Boolean)
    .join('\n');
}

async function sendTelegramMessage(chatId, text, extra = {}) {
  if (!isTelegramEnabled()) {
    throw new Error('telegram is not enabled');
  }

  if (!chatId) {
    throw new Error('telegram chat id is required');
  }

  if (!text || !String(text).trim()) {
    throw new Error('telegram message text is required');
  }

  if (typeof fetch !== 'function') {
    throw new Error('global fetch is not available in this runtime');
  }

  const payload = {
    chat_id: String(chatId),
    text: String(text),
    parse_mode: extra.parse_mode || 'HTML',
    disable_web_page_preview:
      typeof extra.disable_web_page_preview === 'boolean'
        ? extra.disable_web_page_preview
        : true,
    disable_notification:
      typeof extra.disable_notification === 'boolean'
        ? extra.disable_notification
        : false
  };

  const response = await fetch(buildTelegramUrl('sendMessage'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok) {
    const message =
      data?.description ||
      `telegram send failed with status ${response.status}`;

    logger.error({
      type: 'TELEGRAM_MESSAGE_FAILED',
      chatId: String(chatId),
      statusCode: response.status,
      error: message
    });

    throw new Error(message);
  }

  logger.info({
    type: 'TELEGRAM_MESSAGE_SENT',
    chatId: String(chatId),
    messageId: data?.result?.message_id || null
  });

  return data.result;
}

async function sendMatchAlert({
  recipient,
  sourceListing,
  targetListing,
  score,
  explanation
}) {
  if (!recipient?.telegram_chat_id) {
    throw new Error('recipient telegram chat id is missing');
  }

  const text = buildMatchAlertMessage({
    recipientName: pickRecipientName(recipient),
    sourceListing,
    targetListing,
    score,
    explanation
  });

  return sendTelegramMessage(recipient.telegram_chat_id, text, {
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });
}

module.exports = {
  isTelegramEnabled,
  buildTelegramUrl,
  escapeHtml,
  formatMoney,
  pickDisplayPrice,
  normalizeListingType,
  pickRecipientName,
  buildMatchAlertMessage,
  sendTelegramMessage,
  sendMatchAlert
};
