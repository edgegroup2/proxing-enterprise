'use strict';

const db = require('../../db');

async function getActiveSubscription(userId) {
  const result = await db.query(`
    SELECT us.*, sp.code AS plan_code, sp.name AS plan_name
    FROM user_subscriptions us
    JOIN subscription_plans sp ON sp.id = us.plan_id
    WHERE us.user_id = $1
      AND us.status = 'active'
      AND us.ends_at > now()
    ORDER BY us.ends_at DESC
    LIMIT 1
  `, [userId]);

  return result.rows[0] || null;
}

async function hasPremiumAccess(userId, featureCode = 'education_premium') {
  const sub = await getActiveSubscription(userId);
  return !!sub;
}

module.exports = {
  getActiveSubscription,
  hasPremiumAccess
};
