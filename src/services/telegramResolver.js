const db = require("../db");

async function resolveUserByTelegram(telegramId) {
  const { rows } = await db.query(
    `SELECT * FROM users WHERE telegram_id = $1`,
    [telegramId]
  );

  if (!rows[0]) {
    throw new Error("Telegram account not linked to any user");
  }

  return rows[0];
}

module.exports = { resolveUserByTelegram };
