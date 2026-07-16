'use strict';

const { getRedis, initRedis } = require('../realtime/redisClient');
const { emitEvent } = require('../realtime/bus');
const presence = require('../services/presenceService');

const STREAM = 'proxing:match:requests';
const GROUP = 'matchers';
const CONSUMER = `c-${process.pid}`;

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

async function ensureGroup(redis) {
  try {
    await redis.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true });
  } catch (e) {
    if (!String(e?.message || '').includes('BUSYGROUP')) throw e;
  }
}

function parseFields(fields) {
  const obj = {};
  for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
  return obj;
}

async function handleRequest(id, data) {
  const userId = String(data.userId || '').trim();
  const providerType = String(data.providerType || '').trim();
  const specialty = data.specialty ? String(data.specialty).trim() : '';

  if (!userId || !providerType) {
    await emitEvent({
      type: 'match:error',
      userId,
      payload: { error: 'Invalid match request', requestId: id },
    });
    return;
  }

  const found = await presence.findAvailable({ providerType, specialty: specialty || null });

  if (!found) {
    await emitEvent({
      type: 'match:none',
      userId,
      payload: { requestId: id, providerType, specialty },
    });
    return;
  }

  // Mark busy immediately to prevent double-match
  await presence.setBusy({
    providerId: found.providerId,
    providerType,
    specialty: found.matchedOn === 'specialty' ? specialty : null,
  });

  await emitEvent({
    type: 'match:found',
    userId,
    providerId: found.providerId,
    payload: {
      requestId: id,
      providerType,
      specialty: specialty || null,
      matchedOn: found.matchedOn,
      providerId: found.providerId,
    },
  });
}

async function run() {
  await initRedis(REDIS_URL);
  const redis = getRedis();
  await ensureGroup(redis);

  console.log('✅ matchWorker started', { STREAM, GROUP, CONSUMER });

  while (true) {
    try {
      const res = await redis.xReadGroup(
        GROUP,
        CONSUMER,
        [{ key: STREAM, id: '>' }],
        { COUNT: 10, BLOCK: 5000 }
      );

      if (!res) continue;

      for (const stream of res) {
        for (const message of stream.messages) {
          const msgId = message.id;
          const data = parseFields(message.message);

          try {
            await handleRequest(msgId, data);
            await redis.xAck(STREAM, GROUP, msgId);
          } catch (e) {
            console.error('handleRequest error', e);
            // don't ack -> retry later
          }
        }
      }
    } catch (e) {
      console.error('worker loop error', e);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

run().catch((e) => {
  console.error('matchWorker crashed', e);
  process.exit(1);
});
