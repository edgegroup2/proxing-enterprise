const axios = require("axios");
const logger = require("../logger");

async function sendSMS(message) {
  if (process.env.ENABLE_SMS_ALERTS !== "true") return;

  await axios.post("https://api.ng.termii.com/api/sms/send", {
    to: process.env.ALERT_PHONE,
    from: "ProxiNG",
    sms: message,
    type: "plain",
    channel: "generic",
    api_key: process.env.TERMII_API_KEY,
  });
}

async function sendTelegram(message) {
  if (process.env.ENABLE_TELEGRAM_ALERTS !== "true") return;

  await axios.post(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
    }
  );
}

async function alertAll(message) {
  try {
    await Promise.all([sendSMS(message), sendTelegram(message)]);
  } catch (err) {
    logger.error("Alert failed:", err.message);
  }
}

module.exports = { alertAll };
