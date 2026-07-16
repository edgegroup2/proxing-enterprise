'use strict';

const logger = require('../../util/logger');

const TELEGRAM_ENABLED =
  String(process.env.TELEGRAM_ENABLED || 'false').toLowerCase() === 'true';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

function isEnabled() {
  return TELEGRAM_ENABLED && Boolean(TELEGRAM_BOT_TOKEN);
}

function buildUrl(method) {
  return `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/${method}`;
}

async function sendTelegram({ chatId, text, parseMode = 'HTML' }) {
  if (!isEnabled()) {
    throw new Error('telegram is not enabled');
  }

  if (!chatId) {
    throw new Error('telegram chat id is required');
  }

  if (typeof fetch !== 'function') {
    throw new Error('global fetch is not available in this runtime');
  }

  const response = await fetch(buildUrl('sendMessage'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: String(chatId),
      text: String(text || ''),
      parse_mode: parseMode,
      disable_web_page_preview: true
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    throw new Error(data?.description || `telegram send failed with status ${response.status}`);
  }

  logger.info({
    type: 'TELEGRAM_MESSAGE_SENT',
    chatId: String(chatId),
    messageId: data?.result?.message_id || null
  });

  return data.result;
}

module.exports = {
  isEnabled,
  sendTelegram
};
