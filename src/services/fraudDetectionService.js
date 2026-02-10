const db = require("../db");

async function checkVelocity(amount) {
  const { rows } = await db.query(
    `SELECT SUM(amount) total
     FROM vtpass_auto_funding_logs
     WHERE created_at > NOW() - INTERVAL '1 hour'`
  );

  if (rows[0].total > Number(process.env.MAX_HOURLY_FUNDING)) {
    throw new Error("Velocity limit exceeded");
  }
}

module.exports = { checkVelocity };
