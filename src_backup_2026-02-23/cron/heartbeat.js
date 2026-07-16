const cron = require("node-cron");
const { sendTelegram } = require("../services/telegramService");

function startHeartbeat() {
  if (process.env.ENABLE_CRONS !== "true") return;

  cron.schedule("*/30 * * * *", async () => {
    await sendTelegram("❤️ ProxiNG server heartbeat: ONLINE");
  });
}

module.exports = { startHeartbeat };
