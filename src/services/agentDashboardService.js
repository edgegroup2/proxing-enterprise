'use strict';

const db = require('../db');
const {
  getOrCreateAgentProfile,
  getEffectiveSharePercent,
} = require('./agentProfileService');
const {
  getAgentCommissionSummary,
  listAgentCommissions,
} = require('./agentCommissionService');

async function getAgentWallet(userId, client = null) {
  const runner = client || db;

  const result = await runner.query(
    `
      SELECT
        id,
        user_id,
        balance,
        available_balance,
        locked_balance,
        currency,
        created_at,
        updated_at
      FROM wallets
      WHERE user_id = $1
      LIMIT 1
    `,
    [String(userId)]
  );

  return result.rows[0] || null;
}

async function getAgentRecentTransactions(userId, limit = 20, client = null) {
  const runner = client || db;

  const result = await runner.query(
    `
      SELECT
        id,
        user_id,
        seller_user_id,
        reference,
        type,
        amount,
        provider,
        status,
        channel,
        actor_type,
        source_surface,
        meta,
        created_at,
        updated_at
      FROM transactions
      WHERE (
        seller_user_id = $1
        OR (
          COALESCE(actor_type, meta->>'actor_type') = 'agent'
          AND COALESCE(seller_user_id::text, meta->>'seller_user_id') = $1
        )
      )
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [String(userId), Math.max(1, Math.min(Number(limit) || 20, 100))]
  );

  return result.rows;
}

async function getAgentDashboard(userId, client = null) {
  const runner = client || db;

  const profile = await getOrCreateAgentProfile(userId, runner);
  const wallet = await getAgentWallet(userId, runner);
  const summary = await getAgentCommissionSummary(userId, runner);
  const ledger = await listAgentCommissions(userId, 20, runner);
  const recentTransactions = await getAgentRecentTransactions(userId, 20, runner);

  return {
    profile: {
      status: profile.status,
      vtpass_enabled: !!profile.vtpass_enabled,
      telegram_linked: !!profile.telegram_linked,
      effective_share_percent: getEffectiveSharePercent(profile),
      approved_at: profile.approved_at,
      rejected_at: profile.rejected_at,
      rejection_reason: profile.rejection_reason,
    },
    wallet: wallet
      ? {
          id: wallet.id,
          balance: Number(wallet.balance || 0),
          available_balance: Number(wallet.available_balance || 0),
          locked_balance: Number(wallet.locked_balance || 0),
          currency: wallet.currency || 'NGN',
        }
      : {
          id: null,
          balance: 0,
          available_balance: 0,
          locked_balance: 0,
          currency: 'NGN',
        },
    commissionWallet: {
      available: Number(summary.available_commission || 0),
    },
    stats: {
      salesToday: Number(summary.sales_today || 0),
      commissionToday: Number(summary.commission_today || 0),
      totalSales: Number(summary.total_sales || 0),
      totalCommission: Number(summary.total_commission || 0),
    },
    commissionLedger: ledger,
    recentTransactions,
  };
}

module.exports = {
  getAgentDashboard,
  getAgentRecentTransactions,
  getAgentWallet,
};
