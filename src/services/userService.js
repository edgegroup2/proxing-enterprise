const db = require("../db");

/**
 * Get user by ID
 */
async function getUserById(id) {
  const { rows } = await db.query(
    "SELECT id, phone, email, role, status FROM users WHERE id = $1",
    [id]
  );

  return rows[0] || null;
}

/**
 * Get user by phone
 */
async function getUserByPhone(phone) {
  const { rows } = await db.query(
    "SELECT id, phone, email, role, status FROM users WHERE phone = $1",
    [phone]
  );

  return rows[0] || null;
}

module.exports = {
  getUserById,
  getUserByPhone,
};
