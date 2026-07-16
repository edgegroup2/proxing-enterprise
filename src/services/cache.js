'use strict';

const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
});

redis.on('error', err => {
  console.warn('[REDIS_ERROR]', err.message);
});

async function getJson(key) {
  const value = await redis.get(key);
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function setJson(key, value, ttlSeconds = 300) {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

async function del(key) {
  await redis.del(key);
}

module.exports = {
  redis,
  getJson,
  setJson,
  del,
};
