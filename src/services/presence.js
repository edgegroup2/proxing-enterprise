'use strict';

const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
const HB_TTL_SECONDS = Number(process.env.PRESENCE_TTL_SECONDS || 60);

function kAvail(type) { return `avail:${type}`; }
function kAvailSpec(type, spec) { return `avail:${type}:${spec}`; }
function kOnline(type) { return `online:${type}`; }
function kOnlineSpec(type, spec) { return `online:${type}:${spec}`; }

function kProvider(id) { return `provider:${id}`; }
function kHb(id) { return `hb:${id}`; }

async function heartbeat({ providerId, providerType, specialty, socketId }) {
  // Keep heartbeat TTL
  await redis.set(kHb(providerId), '1', 'EX', HB_TTL_SECONDS);

  // Update state
  await redis.hset(kProvider(providerId), {
    providerType: providerType || '',
    specialty: specialty || '',
    socketId: socketId || '',
    lastSeen: Date.now().toString(),
  });
}

async function markOnline({ providerId, providerType, specialty }) {
  if (!providerId || !providerType) return;

  // Mark online
  await redis.sadd(kOnline(providerType), providerId);
  if (specialty) await redis.sadd(kOnlineSpec(providerType, specialty), providerId);

  // If not busy, mark available
  const busy = await redis.hget(kProvider(providerId), 'busy');
  if (busy !== '1') {
    await redis.sadd(kAvail(providerType), providerId);
    if (specialty) await redis.sadd(kAvailSpec(providerType, specialty), providerId);
  }
}

async function markOffline({ providerId }) {
  if (!providerId) return;

  const providerType = await redis.hget(kProvider(providerId), 'providerType');
  const specialty = await redis.hget(kProvider(providerId), 'specialty');

  if (providerType) {
    await redis.srem(kOnline(providerType), providerId);
    await redis.srem(kAvail(providerType), providerId);
    if (specialty) {
      await redis.srem(kOnlineSpec(providerType, specialty), providerId);
      await redis.srem(kAvailSpec(providerType, specialty), providerId);
    }
  }

  await redis.del(kHb(providerId));
  await redis.hset(kProvider(providerId), { busy: '0' });
}

async function markBusy({ providerId }) {
  if (!providerId) return;

  const providerType = await redis.hget(kProvider(providerId), 'providerType');
  const specialty = await redis.hget(kProvider(providerId), 'specialty');

  // Remove from availability
  if (providerType) {
    await redis.srem(kAvail(providerType), providerId);
    if (specialty) await redis.srem(kAvailSpec(providerType, specialty), providerId);
  }

  await redis.hset(kProvider(providerId), { busy: '1' });
}

async function unmarkBusy({ providerId }) {
  if (!providerId) return;

  const providerType = await redis.hget(kProvider(providerId), 'providerType');
  const specialty = await redis.hget(kProvider(providerId), 'specialty');

  // Only add back if heartbeat exists (still online)
  const hb = await redis.exists(kHb(providerId));
  if (!hb) {
    await redis.hset(kProvider(providerId), { busy: '0' });
    return;
  }

  if (providerType) {
    await redis.sadd(kAvail(providerType), providerId);
    if (specialty) await redis.sadd(kAvailSpec(providerType, specialty), providerId);
  }

  await redis.hset(kProvider(providerId), { busy: '0' });
}

/**
 * Specialty optional rule:
 * - if specialty provided: try avail:type:specialty first, else fallback avail:type
 * - if specialty not provided: just use avail:type
 */
async function pickAvailableProvider({ providerType, specialty }) {
  if (!providerType) return null;

  if (specialty) {
    // Try specialty first
    const specKey = kAvailSpec(providerType, specialty);
    const anyKey = kAvail(providerType);

    // Get one ID (non-destructive selection)
    let id = await redis.srandmember(specKey);
    if (!id) id = await redis.srandmember(anyKey);
    return id || null;
  }

  return (await redis.srandmember(kAvail(providerType))) || null;
}

module.exports = {
  redis,
  heartbeat,
  markOnline,
  markOffline,
  markBusy,
  unmarkBusy,
  pickAvailableProvider,
};
