'use strict';

const { Server } = require('socket.io');

let io = null;

function resolveUserIdFromHandshake(socket) {
  return (
    socket.handshake?.auth?.userId ||
    socket.handshake?.headers?.['x-user-id'] ||
    socket.handshake?.query?.userId ||
    null
  );
}

function resolveApiKeyFromHandshake(socket) {
  return (
    socket.handshake?.auth?.apiKey ||
    socket.handshake?.headers?.['x-api-key'] ||
    socket.handshake?.query?.apiKey ||
    null
  );
}

function userRoom(userId) {
  return `user:${String(userId)}`;
}

function dealRoomChannel(roomId) {
  return `deal-room:${String(roomId)}`;
}

function initSocket(server) {
  if (io) return io;

  io = new Server(server, {
    cors: {
      origin: true,
      credentials: true
    }
  });

  io.use((socket, next) => {
    try {
      const userId = resolveUserIdFromHandshake(socket);
      const apiKey = resolveApiKeyFromHandshake(socket);

      if (!apiKey) {
        return next(new Error('Missing API key'));
      }

      if (!userId) {
        return next(new Error('Missing user identity'));
      }

      socket.user = {
        id: String(userId)
      };

      return next();
    } catch (error) {
      return next(error);
    }
  });

  io.on('connection', (socket) => {
    const me = socket.user?.id;

    if (me) {
      socket.join(userRoom(me));
      socket.emit('socket:ready', {
        ok: true,
        userId: me,
        joined: [userRoom(me)]
      });
    }

    socket.on('deal_room:join', (payload = {}) => {
      const roomId = payload.roomId;
      if (!roomId) return;

      socket.join(dealRoomChannel(roomId));
      socket.emit('deal_room:joined', {
        ok: true,
        roomId: String(roomId)
      });
    });

    socket.on('deal_room:leave', (payload = {}) => {
      const roomId = payload.roomId;
      if (!roomId) return;

      socket.leave(dealRoomChannel(roomId));
      socket.emit('deal_room:left', {
        ok: true,
        roomId: String(roomId)
      });
    });

    socket.on('ping:app', () => {
      socket.emit('pong:app', {
        ok: true,
        ts: Date.now()
      });
    });
  });

  return io;
}

function getIO() {
  return io;
}

function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(userRoom(userId)).emit(event, payload);
}

function emitToUsers(userIds, event, payload) {
  if (!io || !Array.isArray(userIds)) return;

  const sent = new Set();

  for (const userId of userIds) {
    if (!userId) continue;
    const key = String(userId);
    if (sent.has(key)) continue;
    sent.add(key);
    io.to(userRoom(key)).emit(event, payload);
  }
}

function emitToDealRoom(roomId, event, payload) {
  if (!io || !roomId) return;
  io.to(dealRoomChannel(roomId)).emit(event, payload);
}

module.exports = {
  initSocket,
  getIO,
  emitToUser,
  emitToUsers,
  emitToDealRoom,
  userRoom,
  dealRoomChannel
};
