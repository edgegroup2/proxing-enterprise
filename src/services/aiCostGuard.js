'use strict';

const db = require('../db');

const DAILY_LIMIT = Number(process.env.AI_DAILY_COST_LIMIT || 5); // USD-ish estimate
const MONTHLY_LIMIT = Number(process.env.AI_MONTHLY_COST_LIMIT || 100);

async function logAiUsage({
  feature,
  cacheKey = null,
  model = null,
  promptTokens = 0,
  completionTokens = 0,
  estimatedCost = 0,
  cacheHit = false,
}) {
  await db.query(
    `
    INSERT INTO ai_usage_logs
      (feature, cache_key, model, prompt_tokens, completion_tokens, estimated_cost, cache_hit)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    `,
    [feature, cacheKey, model, promptTokens, completionTokens, estimatedCost, cacheHit]
  );
}

async function getCostStats() {
  const today = await db.query(`
    SELECT COALESCE(SUM(estimated_cost), 0)::float AS cost
    FROM ai_usage_logs
    WHERE created_at >= CURRENT_DATE
  `);

  const month = await db.query(`
    SELECT COALESCE(SUM(estimated_cost), 0)::float AS cost
    FROM ai_usage_logs
    WHERE created_at >= date_trunc('month', NOW())
  `);

  const cache = await db.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE cache_hit = true)::int AS cache_hits
    FROM ai_usage_logs
    WHERE created_at >= NOW() - INTERVAL '24 hours'
  `);

  const total = cache.rows[0]?.total || 0;
  const cacheHits = cache.rows[0]?.cache_hits || 0;

  return {
    todayCost: today.rows[0].cost,
    monthCost: month.rows[0].cost,
    dailyLimit: DAILY_LIMIT,
    monthlyLimit: MONTHLY_LIMIT,
    cacheHitRate: total ? Math.round((cacheHits / total) * 100) : 0,
  };
}

async function assertBudgetAvailable() {
  const stats = await getCostStats();

  if (stats.todayCost >= DAILY_LIMIT) {
    throw new Error(`AI daily budget exceeded: ${stats.todayCost}/${DAILY_LIMIT}`);
  }

  if (stats.monthCost >= MONTHLY_LIMIT) {
    throw new Error(`AI monthly budget exceeded: ${stats.monthCost}/${MONTHLY_LIMIT}`);
  }

  return stats;
}

module.exports = {
  logAiUsage,
  getCostStats,
  assertBudgetAvailable,
};
