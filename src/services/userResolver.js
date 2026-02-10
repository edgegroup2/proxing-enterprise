const db = require("../db");

/**
 * Resolve user from phone number
 */
async function resolveUserByPhone(phone) {
  const { rows } = await db.query(
    `SELECT * FROM users WHERE phone = $1`,
    [phone]
  );

  if (!rows[0]) {
    throw new Error("User not registered");
  }

  return rows[0];
}

module.exports = { resolveUserByPhone };
