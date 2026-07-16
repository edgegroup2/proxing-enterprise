'use strict';

const db = require('../db');
const { getRedis } = require('../realtime/redisClient');

function safeGetIO() {
  try {
    // your socket file appears to be src/socket.js
    const { getIO } = require('../socket');
    return typeof getIO === 'function' ? getIO() : null;
  } catch (_) {
    return null;
  }
}

async function fetchWalletSnapshot(userId) {
  const { rows } = await db.query(
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
    [userId]
  );

  if (!rows.length) {
    return null;
  }

  const row = rows[0];

  return {
    id: row.id,
    user_id: row.user_id,
    balance: Number(row.balance || 0),
    available_balance: Number(row.available_balance || 0),
    locked_balance: Number(row.locked_balance || 0),
    currency: row.currency || 'NGN',
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function publishWalletUpdate(userId, payload) {
  try {
    const redis = getRedis();
    await redis.publish(
      'wallet:updates',
      JSON.stringify({
        userId: String(userId),
        ...payload
      })
    );
  } catch (_) {
    // non-blocking
  }
}

async function emitWalletUpdate(userId, meta = {}) {
  if (!userId) return null;

  const wallet = await fetchWalletSnapshot(userId);
  if (!wallet) return null;

  const payload = {
    type: 'wallet.updated',
    userId: String(userId),
    wallet,
    meta: {
      reference: meta.reference || null,
      source: meta.source || null,
      channel: meta.channel || null,
      service: meta.service || null,
      network: meta.network || null,
      status: meta.status || null,
      emittedAt: new Date().toISOString()
    }
  };

  const io = safeGetIO();

  if (io) {
    io.to(`user:${String(userId)}`).emit('wallet:update', payload);
  }

  await publishWalletUpdate(userId, payload);

  return payload;
}

module.exports = {
  fetchWalletSnapshot,
  emitWalletUpdate
};
