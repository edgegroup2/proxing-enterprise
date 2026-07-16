'use strict';

const redis = require('../realtime/redisClient');

const DUPLICATE_TTL = 60; // seconds

async function isDuplicateSMS(from, message) {
  try {
    const key = `sms:dup:${from}:${message.toLowerCase().trim()}`;

    const exists = await redis.get(key);

    if (exists) {
      return true;
    }

    await redis.set(key, 1, 'EX', DUPLICATE_TTL);

    return false;

  } catch (err) {
    console.error('Duplicate SMS check failed:', err.message);
    return false;
  }
}

module.exports = {
  isDuplicateSMS
};
