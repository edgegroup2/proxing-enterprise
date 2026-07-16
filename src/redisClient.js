'use strict';

const Redis = require('ioredis');

const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redis = new Redis(url, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
});

redis.on('error', (e) => {
  // keep process alive; log in pm2 logs
  console.error('Redis error:', e?.message || e);
});

module.exports = redis;
