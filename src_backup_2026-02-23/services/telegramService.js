/**
 * TELEGRAM ALERT SERVICE
 * Centralized Alert Channel
 * Production Hardened
 */

const axios = require("axios");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.warn("⚠️ Telegram alerts disabled (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)");
}

/**
 * Send Telegram Message
 * @param {string} message
 * @param {object} options
 */
async function sendTelegram(message, options = {}) {
  try {
    if (!BOT_TOKEN || !CHAT_ID) return;

    if (!message || typeof message !== "string") return;

    // Telegram message limit protection (4096 chars)
    const MAX_LENGTH = 4000;
    const safeMessage =
      message.length > MAX_LENGTH
        ? message.substring(0, MAX_LENGTH) + "\n\n... truncated ..."
        : message;

    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: safeMessage,
        parse_mode: options.parseMode || "HTML",
        disable_notification: options.silent || false,
      },
      { timeout: 10000 }
    );

  } catch (err) {
    console.error("❌ Telegram send failed:", err.response?.data || err.message);
  }
}

/**
 * Financial Alert Wrapper
 */
async function sendFinanceAlert(title, body) {
  const message = `
💰 <b>${title}</b>

${body}

🕒 ${new Date().toISOString()}
`;
  await sendTelegram(message);
}

/**
 * Security Alert Wrapper
 */
async function sendSecurityAlert(body) {
  const message = `
🚨 <b>SECURITY ALERT</b>

${body}

🕒 ${new Date().toISOString()}
`;
  await sendTelegram(message);
}

/**
 * System Alert Wrapper
 */
async function sendSystemAlert(body) {
  const message = `
⚙️ <b>SYSTEM ALERT</b>

${body}

🕒 ${new Date().toISOString()}
`;
  await sendTelegram(message);
}

module.exports = {
  sendTelegram,
  sendFinanceAlert,
  sendSecurityAlert,
  sendSystemAlert,
};
