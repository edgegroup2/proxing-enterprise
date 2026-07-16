'use strict';

const { getRedis } = require('../realtime/redisClient');

const ONLINE_TTL_MS = Number(process.env.PRESENCE_TTL_MS || 45000); // 45s default
const BUSY_TTL_MS = Number(process.env.BUSY_TTL_MS || 15 * 60 * 1000); // 15 min default

function zkey(providerType, specialty) {
  const t = String(providerType || '').trim().toLowerCase();
  if (!t) throw new Error('providerType required');

  if (specialty) {
    const s = String(specialty).trim().toLowerCase();
    return `online:${t}:${s}`;
  }
  return `online:${t}`;
}

function busyKey(providerType, specialty) {
  const t = String(providerType || '').trim().toLowerCase();
  if (!t) throw new Error('providerType required');

  if (specialty) {
    const s = String(specialty).trim().toLowerCase();
    return `busy:${t}:${s}`;
  }
  return `busy:${t}`;
}

async function cleanupOnline(providerType, specialty) {
  const r = getRedis();
  const key = zkey(providerType, specialty);
  const cutoff = Date.now() - ONLINE_TTL_MS;
  await r.zRemRangeByScore(key, 0, cutoff);
}

/**
 * Mark provider online in:
 * - online:<type>
 * - online:<type>:<specialty> (optional)
 */
async function setOnline({ providerId, providerType, specialty }) {
  const r = getRedis();
  const id = String(providerId);
  const now = Date.now();

  await r.zAdd(zkey(providerType), [{ score: now, value: id }]);
  await cleanupOnline(providerType);

  if (specialty) {
    await r.zAdd(zkey(providerType, specialty), [{ score: now, value: id }]);
    await cleanupOnline(providerType, specialty);
  }

  // Optional metadata
  await r.hSet(`presence:provider:${id}`, {
    providerType: String(providerType).trim().toLowerCase(),
    specialty: specialty ? String(specialty).trim().toLowerCase() : '',
    lastSeen: String(now),
  });
  await r.pExpire(`presence:provider:${id}`, ONLINE_TTL_MS * 3);
}

async function heartbeat({ providerId, providerType, specialty }) {
  return setOnline({ providerId, providerType, specialty });
}

async function setBusy({ providerId, providerType, specialty }) {
  const r = getRedis();
  const id = String(providerId);

  await r.sAdd(busyKey(providerType), id);
  if (specialty) await r.sAdd(busyKey(providerType, specialty), id);

  await r.set(`busy:provider:${id}`, '1', { PX: BUSY_TTL_MS });
}

async function unmarkBusy({ providerId, providerType, specialty }) {
  const r = getRedis();
  const id = String(providerId);

  // best effort removal
  if (providerType) {
    await r.sRem(busyKey(providerType), id);
    if (specialty) await r.sRem(busyKey(providerType, specialty), id);
  }
  await r.del(`busy:provider:${id}`);
}

/**
 * Find available provider:
 * - If specialty provided: try that first
 * - Else: match any under providerType
 * Also excludes anyone in busy set.
 */
async function findAvailable({ providerType, specialty }) {
  const r = getRedis();

  const preferredKey = specialty ? zkey(providerType, specialty) : null;
  const fallbackKey = zkey(providerType);

  if (preferredKey) await cleanupOnline(providerType, specialty);
  await cleanupOnline(providerType);

  const busyPreferred = specialty ? busyKey(providerType, specialty) : null;
  const busyFallback = busyKey(providerType);

  async function pickFromZset(key, busySetKey) {
    const candidates = await r.zRange(key, 0, 30, { REV: true }); // newest first
    if (!candidates || candidates.length === 0) return null;

    if (!busySetKey) return candidates[0];

    for (const id of candidates) {
      const isBusy = await r.sIsMember(busySetKey, id);
      if (!isBusy) return id;
    }
    return null;
  }

  // specialty first
  if (preferredKey) {
    const id1 = await pickFromZset(preferredKey, busyPreferred);
    if (id1) return { providerId: id1, matchedOn: 'specialty' };
  }

  // fallback to any
  const id2 = await pickFromZset(fallbackKey, busyFallback);
  if (id2) return { providerId: id2, matchedOn: 'any' };

  return null;
}

module.exports = { setOnline, heartbeat, setBusy, unmarkBusy, findAvailable };
