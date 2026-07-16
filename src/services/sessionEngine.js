'use strict';

const crypto = require('crypto');
const db = require('../db');
const { holdEscrow, refundEscrowToUser, releaseEscrowToProvider } = require('./escrowEngine');
const { buildRtcToken } = require('./agoraService');
const presence = require('./presenceService');

function channelName() {
  return `p_${crypto.randomBytes(10).toString('hex')}`;
}

async function withLock(lockKey, ttlMs, fn) {
  // simple lock in redis using presence busy key semantics
  const token = crypto.randomBytes(16).toString('hex');
  const ok = await require('../redisClient').set(lockKey, token, 'PX', ttlMs, 'NX');
  if (!ok) throw new Error('Provider is busy (lock)');

  try {
    return await fn();
  } finally {
    // best-effort unlock
    try {
      const redis = require('../redisClient');
      const lua =
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
      await redis.eval(lua, 1, lockKey, token).catch(() => {});
    } catch (_) {}
  }
}

// ✅ FIX: validate package by providerType + active + trim
async function getPackage(packageId, providerType) {
  const pkgId = String(packageId || '').trim();
  const pType = String(providerType || '').trim().toLowerCase();
  if (!pkgId || !pType) return null;

  const r = await db.query(
    `SELECT id, provider_type, name, duration_seconds, price_naira, is_active
     FROM session_packages
     WHERE id=$1 AND provider_type=$2 AND is_active=true
     LIMIT 1`,
    [pkgId, pType]
  );

  return r.rows[0] || null;
}

// ✅ Specialty optional: ignore when null
async function pickAnyAvailable({ providerType, specialty }) {
  const pType = String(providerType || '').trim().toLowerCase();
  if (!pType) return null;

  // Presence list is purely providerType-based (fast). You can extend to specialty sets later.
  const online = await presence.listOnline(pType);
  if (!online.length) return null;

  // If specialty provided, filter via DB
  if (specialty) {
    const spec = String(specialty).trim().toLowerCase();
    const r = await db.query(
      `SELECT id
       FROM providers
       WHERE id = ANY($1::uuid[])
         AND provider_type = $2
         AND is_approved = true
         AND lower(coalesce(specialty,'')) = $3
       LIMIT 1`,
      [online, pType, spec]
    );
    return r.rows[0]?.id || null;
  }

  // Otherwise pick first approved in DB
  const r = await db.query(
    `SELECT id
     FROM providers
     WHERE id = ANY($1::uuid[])
       AND provider_type = $2
       AND is_approved = true
     LIMIT 1`,
    [online, pType]
  );
  return r.rows[0]?.id || null;
}

async function createInstantSession({ userId, providerType, specialty, packageId, providerId = null }) {
  const pType = String(providerType || '').trim().toLowerCase();
  const spec = specialty ? String(specialty).trim().toLowerCase() : null;
  const pkgId = String(packageId || '').trim();

  const pkg = await getPackage(pkgId, pType);
  if (!pkg) throw new Error('Invalid package');

  let chosenProviderId = providerId;
  if (!chosenProviderId) {
    chosenProviderId = await pickAnyAvailable({ providerType: pType, specialty: spec });
    if (!chosenProviderId) throw new Error('No provider available right now');
  }

  // validate provider exists + approved + matches type
  const pr = await db.query(
    `SELECT id, provider_type, is_approved
     FROM providers
     WHERE id=$1
     LIMIT 1`,
    [chosenProviderId]
  );
  const providerRow = pr.rows[0];
  if (!providerRow || !providerRow.is_approved) throw new Error('Provider not available');
  if (String(providerRow.provider_type).toLowerCase() !== pType) throw new Error('Package/provider mismatch');

  const lockKey = `lock:provider:${chosenProviderId}`;

  return withLock(lockKey, 30_000, async () => {
    // mark busy in presence layer too (optional but helps)
    await presence.markBusy(chosenProviderId, 30_000);

    const chan = channelName();

    const ins = await db.query(
      `INSERT INTO sessions
       (user_id, provider_id, provider_type, package_id, status, channel_name)
       VALUES ($1,$2,$3,$4,'active',$5)
       RETURNING *`,
      [userId, chosenProviderId, pType, pkg.id, chan]
    );

    const session = ins.rows[0];

    // hold escrow before issuing tokens
    await holdEscrow({
      sessionId: session.id,
      userId,
      providerId: chosenProviderId,
      amountNaira: pkg.price_naira,
    });

    // Agora tokens (replace with real algo)
    const userUid = Math.abs(Number(BigInt('0x' + crypto.createHash('md5').update(String(userId)).digest('hex'))));
    const providerUid = Math.abs(
      Number(BigInt('0x' + crypto.createHash('md5').update(String(chosenProviderId)).digest('hex')))
    );

    const expireSeconds = Number(pkg.duration_seconds || 1200) + Number(process.env.SESSION_MAX_SECONDS || 600);

    const userToken = buildRtcToken({ channelName: chan, uid: userUid, expireSeconds });
    const providerToken = buildRtcToken({ channelName: chan, uid: providerUid, expireSeconds });

    return {
      session,
      pricing: pkg,
      agora: {
        channelName: chan,
        user: { uid: userUid, token: userToken },
        provider: { uid: providerUid, token: providerToken },
      },
    };
  });
}

async function endSession({ sessionId, endedBy = 'system', status = 'ended' }) {
  const sRes = await db.query(`SELECT * FROM sessions WHERE id=$1 LIMIT 1`, [sessionId]);
  const session = sRes.rows[0];
  if (!session) throw new Error('Session not found');
  if (session.status === 'ended' || session.status === 'cancelled') return session;

  const uRes = await db.query(
    `UPDATE sessions
     SET status=$2, ended_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [sessionId, status]
  );

  const updated = uRes.rows[0];

  if (status === 'ended') await releaseEscrowToProvider({ sessionId });
  else await refundEscrowToUser({ sessionId });

  // clear busy marker best-effort
  try {
    await presence.clearBusy(updated.provider_id);
  } catch (_) {}

  return updated;
}

module.exports = {
  createInstantSession,
  endSession,
};
