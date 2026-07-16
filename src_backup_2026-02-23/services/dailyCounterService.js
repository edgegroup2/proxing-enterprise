const db = require("../db");

async function getToday() {
  const { rows } = await db.query(
    `INSERT INTO vtpass_daily_counters (date)
     VALUES (CURRENT_DATE)
     ON CONFLICT (date) DO NOTHING
     RETURNING *`
  );

  if (rows.length) return rows[0];

  const res = await db.query(
    "SELECT * FROM vtpass_daily_counters WHERE date = CURRENT_DATE"
  );
  return res.rows[0];
}

async function increment(amount) {
  await db.query(
    `UPDATE vtpass_daily_counters
     SET total_amount = total_amount + $1,
         transfer_count = transfer_count + 1
     WHERE date = CURRENT_DATE`,
    [amount]
  );
}

module.exports = { getToday, increment };
