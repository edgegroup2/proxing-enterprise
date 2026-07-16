'use strict';

const db = require('../db');

async function assertWithdrawalAllowed(userId, amount) {
  const client = await db.getClient();

  try {
    const wallet = await client.query(
      `
      SELECT available_balance, tier
      FROM wallets
      WHERE user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (wallet.rowCount === 0) {
      throw new Error('Wallet not found');
    }

    const row = wallet.rows[0];

    if (row.available_balance === null || row.available_balance === undefined) {
      throw new Error('Wallet balance missing');
    }

    const available = Number(row.available_balance);
    const tier = Number(row.tier);

    if (!Number.isFinite(available)) {
      throw new Error('Invalid wallet balance');
    }

    if (available < Number(amount)) {
      throw new Error('Insufficient available balance');
    }

    if (tier < 1) {
      throw new Error('Upgrade to Tier 1 to withdraw');
    }

    const recentCardFunding = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM ledger_entries
      WHERE user_id = $1
        AND type = 'card-credit-locked'
        AND created_at >= NOW() - INTERVAL '24 hours'
      `,
      [userId]
    );

    if (Number(recentCardFunding.rows[0]?.count || 0) > 0) {
      throw new Error('Withdrawals are temporarily locked after recent card funding');
    }

    const recentWithdrawals = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM withdrawals
      WHERE user_id = $1
        AND created_at >= NOW() - INTERVAL '1 day'
      `,
      [userId]
    );

    if (Number(recentWithdrawals.rows[0]?.count || 0) >= 3) {
      throw new Error('Daily withdrawal attempt limit reached');
    }

    return { success: true };
  } finally {
    client.release();
  }
}

module.exports = { assertWithdrawalAllowed };
