'use strict';

const db = require('../db');
const {
  getAgentProfile,
  getEffectiveSharePercent,
} = require('./agentProfileService');

function money(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x : 0;
}

async function resolvePlatformCommission(transactionReference, client = null) {
  const runner = client || db;

  // 1) try dedicated vtpass commission table if present
  try {
    const tableCheck = await runner.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'vtpass_commissions'
        ) AS exists
      `
    );

    if (tableCheck.rows[0]?.exists) {
      const res = await runner.query(
        `
          SELECT amount, commission, profit
          FROM vtpass_commissions
          WHERE transaction_reference = $1
             OR reference = $1
          ORDER BY created_at DESC NULLS LAST
          LIMIT 1
        `,
        [String(transactionReference)]
      );

      if (res.rowCount > 0) {
        const row = res.rows[0];
        return money(row.commission || row.profit || 0);
      }
    }
  } catch (_) {}

  // 2) fallback to transactions.profit/provider_fee/provider commission markers
  const tx = await runner.query(
    `
      SELECT
        id,
        amount,
        provider_fee,
        cost_price,
        profit,
        meta
      FROM transactions
      WHERE reference = $1
      LIMIT 1
    `,
    [String(transactionReference)]
  );

  const row = tx.rows[0];
  if (!row) return 0;

  const meta = row.meta || {};

  const fromMeta =
    money(meta.platform_commission) ||
    money(meta.provider_commission) ||
    money(meta.commission) ||
    0;

  if (fromMeta > 0) return fromMeta;

  if (money(row.profit) > 0) return money(row.profit);
  if (money(row.provider_fee) > 0) return money(row.provider_fee);

  return 0;
}

async function recordAgentCommission({
  agentUserId,
  transactionReference,
  transactionId = null,
  productType,
  saleAmount,
  platformCommission,
  client = null,
}) {
  const runner = client || db;

  const profile = await getAgentProfile(agentUserId, runner);
  if (!profile) {
    throw new Error('Agent profile not found');
  }

  const sharePercent = getEffectiveSharePercent(profile);
  const agentCommission = money((money(platformCommission) * sharePercent) / 100);

  const result = await runner.query(
    `
      INSERT INTO agent_commissions (
        agent_user_id,
        transaction_reference,
        transaction_id,
        product_type,
        sale_amount,
        platform_commission,
        agent_share_percent,
        agent_commission,
        status,
        meta,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        'earned',
        $9::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (agent_user_id, transaction_reference)
      DO UPDATE SET
        transaction_id = COALESCE(EXCLUDED.transaction_id, agent_commissions.transaction_id),
        product_type = EXCLUDED.product_type,
        sale_amount = EXCLUDED.sale_amount,
        platform_commission = EXCLUDED.platform_commission,
        agent_share_percent = EXCLUDED.agent_share_percent,
        agent_commission = EXCLUDED.agent_commission,
        meta = COALESCE(agent_commissions.meta, '{}'::jsonb) || COALESCE(EXCLUDED.meta, '{}'::jsonb),
        updated_at = NOW()
      RETURNING *
    `,
    [
      String(agentUserId),
      String(transactionReference),
      transactionId || null,
      String(productType || 'unknown'),
      money(saleAmount),
      money(platformCommission),
      money(sharePercent),
      money(agentCommission),
      JSON.stringify({
        source: 'vtpass-agent-commission',
        telegram_linked: !!profile.telegram_linked,
        profile_status: profile.status,
      }),
    ]
  );

  return result.rows[0];
}

async function createAgentCommissionForTransaction(reference, client = null) {
  const runner = client || db;

  const txRes = await runner.query(
    `
      SELECT
        id,
        user_id,
        seller_user_id,
        amount,
        reference,
        actor_type,
        meta
      FROM transactions
      WHERE reference = $1
      LIMIT 1
    `,
    [String(reference)]
  );

  const tx = txRes.rows[0];
  if (!tx) return null;

  const actorType =
    String(tx.actor_type || tx.meta?.actor_type || '').toLowerCase();

  const agentUserId =
    tx.seller_user_id ||
    tx.meta?.seller_user_id ||
    null;

  if (actorType !== 'agent' || !agentUserId) {
    return null;
  }

  const profile = await getAgentProfile(agentUserId, runner);
  if (!profile) return null;
  if (String(profile.status || '').toLowerCase() !== 'approved') return null;
  if (!profile.vtpass_enabled) return null;

  const platformCommission = await resolvePlatformCommission(reference, runner);

  if (platformCommission <= 0) {
    return null;
  }

  const productType =
    tx.meta?.product_type ||
    tx.meta?.productType ||
    'unknown';

  return recordAgentCommission({
    agentUserId,
    transactionReference: reference,
    transactionId: tx.id,
    productType,
    saleAmount: tx.amount,
    platformCommission,
    client: runner,
  });
}

async function getAgentCommissionSummary(agentUserId, client = null) {
  const runner = client || db;

  const result = await runner.query(
    `
      SELECT
        COALESCE(SUM(CASE WHEN status = 'earned' THEN agent_commission ELSE 0 END), 0) AS available_commission,
        COALESCE(SUM(agent_commission), 0) AS total_commission,
        COALESCE(SUM(sale_amount), 0) AS total_sales,
        COALESCE(SUM(CASE WHEN created_at::date = CURRENT_DATE THEN agent_commission ELSE 0 END), 0) AS commission_today,
        COALESCE(SUM(CASE WHEN created_at::date = CURRENT_DATE THEN sale_amount ELSE 0 END), 0) AS sales_today
      FROM agent_commissions
      WHERE agent_user_id = $1
    `,
    [String(agentUserId)]
  );

  return result.rows[0] || {
    available_commission: 0,
    total_commission: 0,
    total_sales: 0,
    commission_today: 0,
    sales_today: 0,
  };
}

async function listAgentCommissions(agentUserId, limit = 20, client = null) {
  const runner = client || db;

  const result = await runner.query(
    `
      SELECT *
      FROM agent_commissions
      WHERE agent_user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [String(agentUserId), Math.max(1, Math.min(Number(limit) || 20, 100))]
  );

  return result.rows;
}

module.exports = {
  resolvePlatformCommission,
  recordAgentCommission,
  createAgentCommissionForTransaction,
  getAgentCommissionSummary,
  listAgentCommissions,
};
