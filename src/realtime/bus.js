'use strict';

const { createClient } = require('redis');

const CHANNEL = 'proxing:events';

let pub = null;
let sub = null;
let started = false;

async function initBus(io, redisUrl) {
  if (started) return;

  pub = createClient({ url: redisUrl });
  sub = createClient({ url: redisUrl });

  pub.on('error', (e) => console.error('[bus pub error]', e));
  sub.on('error', (e) => console.error('[bus sub error]', e));

  await pub.connect();
  await sub.connect();

  await sub.subscribe(CHANNEL, async (message) => {
    try {
      const evt = JSON.parse(message);

      // Helper: emit to room and SMS if nobody is connected
      const emitToRoom = async (room, type, payload) => {
        if (!room) return;
        const roomName = String(room);

        // Emit realtime
        io.to(roomName).emit(type, payload ?? {});

        // Offline SMS fallback (optional)
        // If you include { offlineSms: { to, message } } in payload, we can send SMS if room empty.
        const offline = payload?.offlineSms;
        if (offline?.to && offline?.message) {
          const sockets = await io.in(roomName).allSockets();
          if (!sockets || sockets.size === 0) {
            await smsService.sendSMS(offline.to, offline.message).catch(() => {});
          }
        }
      };

      // Priority 1: explicit room
      if (evt.room) {
        await emitToRoom(evt.room, evt.type, evt.payload ?? {});
        return;
      }

      // Priority 2: user/provider rooms
      if (evt.userId) await emitToRoom(`user:${evt.userId}`, evt.type, evt.payload ?? {});
      if (evt.providerId) await emitToRoom(`provider:${evt.providerId}`, evt.type, evt.payload ?? {});

      // Priority 3: broadcast fallback (avoid if possible)
      if (!evt.room && !evt.userId && !evt.providerId) {
        io.emit(evt.type, evt.payload ?? {});
      }
    } catch (e) {
      console.error('[bus message parse error]', e);
    }
  });

  started = true;
  console.log('✅ Realtime bus started:', CHANNEL);
}

async function emitEvent(event) {
  if (!pub) throw new Error('Bus not initialized (pub)');
  await pub.publish(CHANNEL, JSON.stringify(event));
}

module.exports = { initBus, emitEvent };
