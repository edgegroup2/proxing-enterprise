const redis = require('./redis');

async function acquireLock(key, ttl = 30000) {
  const result = await redis.set(key, 'locked', 'NX', 'PX', ttl);
  return result === 'OK';
}

async function releaseLock(key) {
  await redis.del(key);
}

module.exports = {
  acquireLock,
  releaseLock
};
