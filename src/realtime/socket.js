'use strict';

const { Server } = require('socket.io');
const logger = require('../utils/logger');

let ioInstance = null;

function userRoom(userId) {
  return `user:${String(userId)}`;
}

function normalizeHandshakeUserId(socket) {
  return (
    socket.handshake?.auth?.userId ||
    socket.handshake?.query?.userId ||
    socket.handshake?.headers?.['x-user-id'] ||
    null
  );
}

function initSocket(server) {
  if (ioInstance) return ioInstance;

  ioInstance = new Server(server, {
    cors: {
      origin: true,
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  ioInstance.on('connection', (socket) => {
    const initialUserId = normalizeHandshakeUserId(socket);

    if (initialUserId) {
      socket.join(userRoom(initialUserId));

      logger.info({
        type: 'SOCKET_JOINED_USER_ROOM',
        socketId: socket.id,
        userId: String(initialUserId)
      });
    }

    socket.on('notifications:subscribe', (payload = {}) => {
      const userId = payload.userId || initialUserId || null;
      if (!userId) return;

      socket.join(userRoom(userId));

      logger.info({
        type: 'SOCKET_NOTIFICATIONS_SUBSCRIBED',
        socketId: socket.id,
        userId: String(userId)
      });
    });

    socket.on('notifications:unsubscribe', (payload = {}) => {
      const userId = payload.userId || initialUserId || null;
      if (!userId) return;

      socket.leave(userRoom(userId));

      logger.info({
        type: 'SOCKET_NOTIFICATIONS_UNSUBSCRIBED',
        socketId: socket.id,
        userId: String(userId)
      });
    });

    socket.on('disconnect', (reason) => {
      logger.info({
        type: 'SOCKET_DISCONNECTED',
        socketId: socket.id,
        reason
      });
    });
  });

  logger.info({
    type: 'SOCKET_INITIALIZED'
  });

  return ioInstance;
}

function getIO() {
  return ioInstance;
}

function emitToUser(userId, eventName, payload) {
  if (!ioInstance || !userId) return false;

  ioInstance.to(userRoom(userId)).emit(eventName, payload);
  return true;
}

module.exports = {
  initSocket,
  getIO,
  emitToUser,
  userRoom
};
