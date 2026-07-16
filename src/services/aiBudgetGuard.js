'use strict';

const db = require('../db');

const DAILY_AI_LIMIT_USD = Number(process.env.DAILY_AI_LIMIT_USD || 2);

async function getTodaySpend() {
  const result = await db.query(`
    SELECT COALESCE(SUM(estimated_cost_usd), 0)::numeric AS total
    FROM ai_usage_logs
    WHERE created_at >= date_trunc('day', now())
  `);

  return Number(result.rows[0]?.total || 0);
}

async function assertBudgetAvailable() {
  const todaySpend = await getTodaySpend();

  if (todaySpend >= DAILY_AI_LIMIT_USD) {
    throw new Error(`Daily AI budget reached: $${todaySpend}`);
  }

  return true;
}

async function logAIUsage({
  feature,
  provider,
  model,
  inputTokens = 0,
  outputTokens = 0,
  estimatedCostUsd = 0,
  status = 'success',
  error = null
}) {
  await db.query(
    `
    INSERT INTO ai_usage_logs (
      feature,
      provider,
      model,
      input_tokens,
      output_tokens,
      estimated_cost_usd,
      status,
      error
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      feature,
      provider,
      model,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      status,
      error
    ]
  );
}

module.exports = {
  getTodaySpend,
  assertBudgetAvailable,
  logAIUsage
};
