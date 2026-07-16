const cron = require("node-cron");
const { sendTelegram } = require("../services/telegramService");

function startHeartbeat() {
const enabled = String(process.env.ENABLE_CRONS || 'false') === 'true';
if (!enabled) return;

  cron.schedule("*/30 * * * *", async () => {
    await sendTelegram("❤️ ProxiNG server heartbeat: ONLINE");
  });
}

module.exports = { startHeartbeat };
