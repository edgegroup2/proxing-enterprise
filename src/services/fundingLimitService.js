const db = require('../db')

async function getCardFundingStats(userId) {
  const client = await db.getClient()
  try {
    const daily = await client.query(
      `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM fundings
      WHERE user_id = $1
        AND provider = 'paystack'
        AND status = 'success'
        AND created_at >= NOW() - interval '1 day'
      `,
      [userId]
    )

    const weekly = await client.query(
      `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM fundings
      WHERE user_id = $1
        AND provider = 'paystack'
        AND status = 'success'
        AND created_at >= NOW() - interval '7 days'
      `,
      [userId]
    )

    return {
      daily: Number(daily.rows[0]?.total || 0),
      weekly: Number(weekly.rows[0]?.total || 0),
    }
  } finally {
    client.release()
  }
}

async function assertCardFundingWithinLimit(userId, amount) {
  const numericAmount = Number(amount)
  const stats = await getCardFundingStats(userId)

  if (stats.daily + numericAmount > 20000) {
    throw new Error('Daily card funding limit exceeded. Max is ₦20,000.')
  }

  if (stats.weekly + numericAmount > 100000) {
    throw new Error('Weekly card funding limit exceeded. Max is ₦100,000.')
  }

  return stats
}

module.exports = {
  getCardFundingStats,
  assertCardFundingWithinLimit,
}
