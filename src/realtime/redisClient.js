'use strict';

const { createClient } = require('redis');

let redis = null;

async function initRedis(redisUrl) {
  if (redis) return redis;

  redis = createClient({ url: redisUrl });
  redis.on('error', (e) => console.error('[redis error]', e));
  await redis.connect();

  console.log('✅ Redis connected');
  return redis;
}

function getRedis() {
  if (!redis) throw new Error('Redis not initialized');
  return redis;
}

module.exports = { initRedis, getRedis };
