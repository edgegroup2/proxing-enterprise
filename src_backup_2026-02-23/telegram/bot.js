const TelegramBot = require("node-telegram-bot-api");
const db = require("../db");
const { parseIntent } = require("../sms/intentParser");
const { routeIntent } = require("../sms/intentRouter");

let bot;

function startTelegramBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log("🚫 Telegram bot disabled");
    return;
  }

  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  console.log("🤖 Telegram bot started");

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();

    if (!text) return;

    // ===== LINK ACCOUNT =====
    if (text.toLowerCase().startsWith("link ")) {
      const phone = text.split(" ")[1];

      if (!phone || phone.length < 10) {
        return bot.sendMessage(chatId, "❌ Invalid phone number");
      }

      const user = await db.oneOrNone(
        "SELECT id FROM users WHERE phone = $1",
        [phone]
      );

      if (!user) {
        return bot.sendMessage(chatId, "❌ Phone not registered on ProxiNG");
      }

      await db.none(
        "UPDATE users SET telegram_id = $1 WHERE id = $2",
        [chatId, user.id]
      );

      return bot.sendMessage(
        chatId,
        "✅ Telegram successfully linked to your ProxiNG account"
      );
    }

    // ===== NORMAL COMMAND FLOW =====
    const user = await db.oneOrNone(
      "SELECT id, phone FROM users WHERE telegram_id = $1",
      [chatId]
    );

    if (!user) {
      return bot.sendMessage(
        chatId,
        "🔐 Account not linked.\n\nSend:\nlink YOUR_PHONE_NUMBER"
      );
    }

    try {
      const intent = parseIntent(text);

      if (!intent) {
        return bot.sendMessage(chatId, "❓ Command not understood");
      }

      await routeIntent(intent, user.phone);

      bot.sendMessage(chatId, "✅ Transaction successful");
    } catch (err) {
      console.error("Telegram error:", err.message);
      bot.sendMessage(chatId, `❌ ${err.message}`);
    }
  });
}

module.exports = { startTelegramBot };
