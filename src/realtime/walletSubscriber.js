'use strict';

const { createClient } = require('redis');

let subscriber = null;
let started = false;

function safeGetIO() {
  try {
    const { getIO } = require('../socket');
    return typeof getIO === 'function' ? getIO() : null;
  } catch (_) {
    return null;
  }
}

async function handleWalletUpdate(message) {
  try {
    const payload = JSON.parse(message);
    const io = safeGetIO();

    if (!io || !payload || !payload.userId) return;

    io.to(`user:${String(payload.userId)}`).emit('wallet:update', payload);
  } catch (err) {
    console.error('[walletSubscriber wallet:update error]', err.message || err);
  }
}

async function handleTokenReady(message) {
  try {
    const payload = JSON.parse(message);
    const io = safeGetIO();

    if (!io || !payload || !payload.userId) return;

    io.to(`user:${String(payload.userId)}`).emit(
      'transaction:token-ready',
      payload
    );
  } catch (err) {
    console.error('[walletSubscriber token subscriber error]', err.message || err);
  }
}

async function startWalletSubscriber(redisUrl) {
  if (started && subscriber) return subscriber;

  subscriber = createClient({
    url: redisUrl || process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  });

  subscriber.on('error', (err) => {
    console.error('[walletSubscriber redis error]', err.message || err);
  });

  await subscriber.connect();

  await subscriber.subscribe('wallet:updates', handleWalletUpdate);
  await subscriber.subscribe('transaction:token_ready', handleTokenReady);

  started = true;
  console.log('[wallet subscriber started]');

  return subscriber;
}

module.exports = {
  startWalletSubscriber,
};
