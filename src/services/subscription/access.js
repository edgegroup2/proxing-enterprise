'use strict';

const db = require('../../db');
const { getJson, setJson, del } = require('../cache');

async function hasPremiumAccess(userId, featureCode = 'education_premium') {
  if (!userId) return false;

  const cacheKey = `premium:${featureCode}:${userId}`;
  const cached = await getJson(cacheKey);
  if (cached !== null) return !!cached;

  const result = await db.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM user_subscriptions us
      JOIN subscription_plans sp ON sp.id = us.plan_id
      WHERE us.user_id = $1
        AND us.status = 'active'
        AND us.ends_at > now()
        AND (
          sp.code = $2
          OR sp.code = 'family_premium_yearly'
          OR sp.code ILIKE '%premium%'
        )
      LIMIT 1
    ) AS premium
    `,
    [userId, featureCode]
  );

  const premium = !!result.rows?.[0]?.premium;
  await setJson(cacheKey, premium, 300);
  return premium;
}

async function clearPremiumAccessCache(userId, featureCode = 'education_premium') {
  if (!userId) return;
  await del(`premium:${featureCode}:${userId}`);
}

module.exports = {
  hasPremiumAccess,
  clearPremiumAccessCache,
};
