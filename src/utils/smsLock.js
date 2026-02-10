const locks = new Map();

const LOCK_TTL = 30 * 1000; // 30 seconds

function isDuplicateSMS(from, message) {
  const key = `${from}:${message.toLowerCase().trim()}`;
  const now = Date.now();

  if (locks.has(key)) {
    const lastTime = locks.get(key);
    if (now - lastTime < LOCK_TTL) {
      return true;
    }
  }

  locks.set(key, now);

  // Auto cleanup
  setTimeout(() => locks.delete(key), LOCK_TTL);
  return false;
}

module.exports = { isDuplicateSMS };
