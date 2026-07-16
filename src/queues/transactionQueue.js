'use strict';

const { getRedis } = require('../realtime/redisClient');

const QUEUE_KEY = 'queue:transactions';

async function enqueueTransaction(job) {
  if (!job || typeof job !== 'object') {
    throw new Error('enqueueTransaction requires a job object');
  }

  const redis = getRedis();
  const payload = JSON.stringify(job);
  await redis.lPush(QUEUE_KEY, payload);

  return {
    queued: true,
    queue: QUEUE_KEY
  };
}

async function dequeueTransaction(timeoutSeconds = 5) {
  const redis = getRedis();

  const result = await redis.brPop(QUEUE_KEY, timeoutSeconds);

  if (!result) {
    return null;
  }

  const raw =
    typeof result === 'object' && result !== null
      ? result.element
      : Array.isArray(result)
        ? result[1]
        : null;

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

module.exports = {
  enqueueTransaction,
  dequeueTransaction,
  QUEUE_KEY
};
