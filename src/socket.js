'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const presence = require('./services/presenceService');
const { attachSchoolIdentity, registerSchoolLessonSocket } = require('./realtime/schoolLessonSocket');

let io = null;

function safeDecodeToken(socket) {
  const authToken =
    socket.handshake?.auth?.token ||
    socket.handshake?.query?.token ||
    socket.handshake?.headers?.authorization ||
    '';

  const token = String(authToken).replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-change-me');
  } catch (_) {
    return null;
  }
}

function initSocket(server) {
  io = new Server(server, {
    cors: { origin: true, credentials: true },
  });

  io.on('connection', (socket) => {
    const decoded = safeDecodeToken(socket);

    attachSchoolIdentity(socket, decoded);
    registerSchoolLessonSocket(io, socket);
    if (decoded?.id) {
      const userId = String(decoded.id);
      const role = String(decoded.role || 'user');

      socket.join(`user:${userId}`);
      if (role === 'provider') socket.join(`provider:${userId}`);

      socket.user = { id: userId, role };
    }

socket.on('room:join', ({ roomId }) => {
  const id = String(roomId || '').trim();
  if (!id) return;
  socket.join(`room:${id}`);
});

socket.on('room:leave', ({ roomId }) => {
  const id = String(roomId || '').trim();
  if (!id) return;
  socket.leave(`room:${id}`);
});

// Squad rooms
  socket.on('join_squad', ({ squad_id, user_id }) => {
    const squadId = String(squad_id || '').trim();
    const userId = String(user_id || socket.user?.id || '').trim();

    if (!squadId || !userId) return;

    socket.join(`squad:${squadId}`);

    io.to(`squad:${squadId}`).emit('player_joined_squad', {
      squad_id: squadId,
      user_id: userId,
      socket_id: socket.id
    });
  });

  socket.on('leave_squad', ({ squad_id, user_id }) => {
    const squadId = String(squad_id || '').trim();
    const userId = String(user_id || socket.user?.id || '').trim();

    if (!squadId) return;

    socket.leave(`squad:${squadId}`);

    io.to(`squad:${squadId}`).emit('player_left_squad', {
      squad_id: squadId,
      user_id: userId,
      socket_id: socket.id
    });
  });

  // Squad challenge rooms
  socket.on('join_challenge', ({ challenge_id, user_id }) => {
    const challengeId = String(challenge_id || '').trim();
    const userId = String(user_id || socket.user?.id || '').trim();

    if (!challengeId || !userId) return;

    socket.join(`challenge:${challengeId}`);

    io.to(`challenge:${challengeId}`).emit('player_joined_challenge', {
      challenge_id: challengeId,
      user_id: userId,
      socket_id: socket.id
    });
  });

  socket.on('leave_challenge', ({ challenge_id, user_id }) => {
    const challengeId = String(challenge_id || '').trim();
    const userId = String(user_id || socket.user?.id || '').trim();

    if (!challengeId) return;

    socket.leave(`challenge:${challengeId}`);

    io.to(`challenge:${challengeId}`).emit('player_left_challenge', {
      challenge_id: challengeId,
      user_id: userId,
      socket_id: socket.id
    });
  });

    // Category rooms (discovery notifications)
    socket.on('joinCategory', ({ providerType, specialty }) => {
      const type = String(providerType || '').trim().toLowerCase();
      const spec = specialty ? String(specialty).trim().toLowerCase() : '';

      if (!type) return;
      socket.join(`category:${type}`);
      if (spec) socket.join(`category:${type}:${spec}`);
    });

    socket.on('leaveCategory', ({ providerType, specialty }) => {
      const type = String(providerType || '').trim().toLowerCase();
      const spec = specialty ? String(specialty).trim().toLowerCase() : '';

      if (!type) return;
      socket.leave(`category:${type}`);
      if (spec) socket.leave(`category:${type}:${spec}`);
    });

    // Stream rooms (live viewers)
    socket.on('joinStream', ({ streamId }) => {
      const id = String(streamId || '').trim();
      if (!id) return;
      socket.join(`stream:${id}`);
    });

    socket.on('leaveStream', ({ streamId }) => {
      const id = String(streamId || '').trim();
      if (!id) return;
      socket.leave(`stream:${id}`);
    });

    // Provider presence (client emits these)
    socket.on('provider:online', async ({ providerType, specialty }) => {
      try {
        if (socket.user?.role !== 'provider') return;
        const providerId = socket.user.id;

        socket.data.providerType = String(providerType || '').trim().toLowerCase();
        socket.data.specialty = specialty ? String(specialty).trim().toLowerCase() : null;

        await presence.setOnline({
          providerId,
          providerType: socket.data.providerType,
          specialty: socket.data.specialty,
        });
      } catch (_) {}
    });

    socket.on('provider:heartbeat', async () => {
      try {
        if (socket.user?.role !== 'provider') return;
        const providerId = socket.user.id;

        const providerType = socket.data.providerType;
        const specialty = socket.data.specialty;

        if (!providerType) return;

        await presence.heartbeat({ providerId, providerType, specialty });
      } catch (_) {}
    });

    socket.on('disconnect', async () => {
      // We don't hard-remove from zset; TTL cleanup handles it.
      // But you CAN also unmarkBusy here if you want.
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error('socket.io not initialized');
  return io;
}

function userRoom(userId) {
  return `user:${String(userId).trim()}`;
}

function emitToUser(userId, eventName, payload) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedEventName = String(eventName || '').trim();

  if (!io || !normalizedUserId || !normalizedEventName) return false;

  io.to(userRoom(normalizedUserId)).emit(normalizedEventName, payload);
  return true;
}

module.exports = { initSocket, getIO, emitToUser, userRoom };
