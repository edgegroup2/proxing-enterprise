const db = require('../db');

const RISK_THRESHOLD = 75;

async function evaluateWithdrawalRisk(userId, amount) {
  let score = 0;

  const userRes = await db.query(
    `
    SELECT tier, kyc_status, status, created_at
    FROM users
    WHERE id = $1
    `,
    [userId]
  );

  if (!userRes.rows.length) {
    return { score: 100, allowed: false };
  }

  const user = userRes.rows[0];

  // 1️⃣ Account status
  if (user.status !== 'active') score += 50;

  // 2️⃣ KYC
  if (user.kyc_status !== 'verified') score += 20;

  // 3️⃣ New account (< 24h)
  const accountAgeHours =
    (Date.now() - new Date(user.created_at)) / (1000 * 60 * 60);

  if (accountAgeHours < 24) score += 20;

  // 4️⃣ Rapid funding
  const recentFunding = await db.query(
    `
    SELECT COUNT(*) FROM ledger_entries
    WHERE user_id = $1
    AND reference LIKE 'paystack_%'
    AND created_at > NOW() - INTERVAL '10 minutes'
    `,
    [userId]
  );

  if (Number(recentFunding.rows[0].count) > 0) score += 25;

  // 5️⃣ Velocity
  const recentWithdrawals = await db.query(
    `
    SELECT COUNT(*) FROM withdrawals
    WHERE user_id = $1
    AND created_at > NOW() - INTERVAL '5 minutes'
    `,
    [userId]
  );

  if (Number(recentWithdrawals.rows[0].count) > 2) score += 20;

  // 6️⃣ High amount by tier
  const tierLimitRes = await db.query(
    `SELECT tier_limit FROM users WHERE id = $1`,
    [userId]
  );

  const tierLimit = Number(tierLimitRes.rows[0].tier_limit);

  if (amount > tierLimit) score += 40;

  // 7️⃣ Historical failures
  const failedCount = await db.query(
    `
    SELECT COUNT(*) FROM withdrawals
    WHERE user_id = $1
    AND status = 'failed'
    `,
    [userId]
  );

  if (Number(failedCount.rows[0].count) > 3) score += 15;

  return {
    score,
    allowed: score < RISK_THRESHOLD
  };
}

module.exports = {
  evaluateWithdrawalRisk
};
