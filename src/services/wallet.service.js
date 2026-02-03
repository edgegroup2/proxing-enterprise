const db = require("../db");

async function getWallet(userId) {
  const { rows } = await db.query(
    "SELECT * FROM wallets WHERE user_id = $1",
    [userId]
  );
  return rows[0];
}

module.exports = { getWallet };
