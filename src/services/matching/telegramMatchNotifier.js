'use strict';

const db = require('../../db');

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.BOT_TOKEN ||
  null;

const TELEGRAM_API = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function tg(method, payload) {
  if (!TELEGRAM_API) return null;

  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });

  return res.json().catch(() => null);
}

async function getTelegramChatId(userId) {
  const result = await db.query(
    `
      SELECT telegram_chat_id
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0]?.telegram_chat_id || null;
}

function buildMatchMessage({ ownerListing, targetListing, score }) {
  const lines = [
    `<b>✨ New Match Found</b>`,
    ``,
    `We found a nearby possible match for your listing.`,
    ``,
    `📦 Market: <b>${escapeHtml(targetListing.market_type || '-')}</b>`,
    `🏷 Category: <b>${escapeHtml(targetListing.category || '-')}</b>`,
    `📝 Title: <b>${escapeHtml(targetListing.title || 'Potential Match')}</b>`,
    `📍 Location: <b>${escapeHtml(targetListing.location_text || targetListing.city || targetListing.state || '-')}</b>`
  ];

  if (targetListing.price != null) {
    lines.push(`💰 Price: <b>₦${escapeHtml(Number(targetListing.price).toLocaleString())}</b>`);
  }

  if (score != null) {
    lines.push(`📊 Match Score: <b>${escapeHtml(score)}</b>`);
  }

  lines.push(
    '',
    `To continue safely, open ProxiNG and review the match in-app.`,
    `Contact details remain protected until deal flow continues inside the app.`
  );

  return lines.join('\n');
}

async function sendTelegramMatchAlert({ ownerUserId, ownerListing, targetListing, score }) {
  const chatId = await getTelegramChatId(ownerUserId);
  if (!chatId) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing-telegram-chat-id'
    };
  }

  const text = buildMatchMessage({ ownerListing, targetListing, score });

  const response = await tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });

  if (!response?.ok) {
    return {
      ok: false,
      chatId,
      error: response?.description || 'telegram send failed'
    };
  }

  return {
    ok: true,
    chatId,
    providerMessageId: String(response.result?.message_id || '')
  };
}

module.exports = {
  sendTelegramMatchAlert
};

