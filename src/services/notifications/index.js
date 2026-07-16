'use strict';

const logger = require('../../utils/logger');

async function sendTelegram({ to, text, parseMode = 'HTML' }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const base = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

  if (!token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN');
  }

  const url = `${base}/bot${token}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: to,
      text,
      parse_mode: parseMode
    })
  });

  const json = await response.json();

  if (!response.ok || !json.ok) {
    throw new Error(json.description || 'Telegram send failed');
  }

  return {
    ok: true,
    providerMessageId: String(json.result?.message_id || '')
  };
}

async function sendNotification({ channel, to, text, parseMode }) {
  if (channel === 'telegram') {
    return sendTelegram({ to, text, parseMode });
  }

  logger.warn({
    type: 'UNSUPPORTED_NOTIFICATION_CHANNEL',
    channel
  });

  throw new Error(`Unsupported notification channel: ${channel}`);
}

module.exports = {
  sendNotification
};
