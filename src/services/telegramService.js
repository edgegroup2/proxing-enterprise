const axios = require("axios");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.warn("⚠️ Telegram alerts disabled (missing env)");
}

async function sendTelegram(message) {
  if (!BOT_TOKEN || !CHAT_ID) return;

  try {
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: message,
        parse_mode: "HTML",
      },
      { timeout: 10000 }
    );
  } catch (err) {
    console.error("❌ Telegram send failed:", err.message);
  }
}

module.exports = { sendTelegram };
