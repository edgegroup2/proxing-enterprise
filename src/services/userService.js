const db = require("../db");

/**
 * Find user by Telegram chat ID
 */
async function getUserByTelegramId(telegramId) {
  const { rows } = await db.query(
    `SELECT id, phone FROM users WHERE telegram_id = $1`,
    [String(telegramId)]
  );

  return rows[0] || null;
}

/**
 * Link Telegram account to a user (run once)
 */
async function linkTelegramToUser(userId, telegramId) {
  await db.query(
    `UPDATE users SET telegram_id = $1 WHERE id = $2`,
    [String(telegramId), userId]
  );
}

module.exports = {
  getUserByTelegramId,
  linkTelegramToUser,
};
