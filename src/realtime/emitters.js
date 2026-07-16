'use strict';

const { emitToUser } = require('./socket');

function emitNotificationNew(userId, notification) {
  return emitToUser(userId, 'notification:new', notification);
}

function emitUnreadCountChanged(userId, count) {
  return emitToUser(userId, 'notification:unread_count_changed', { count });
}

function emitMatchFound(userId, payload) {
  return emitToUser(userId, 'match:found', payload);
}

function emitDealRoomCreated(userId, payload) {
  return emitToUser(userId, 'deal_room:created', payload);
}

module.exports = {
  emitNotificationNew,
  emitUnreadCountChanged,
  emitMatchFound,
  emitDealRoomCreated
};
