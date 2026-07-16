'use strict';

const { createClient } = require('redis');
const logger = require('../utils/logger');

let client;
let subscriber;

function getRedisUrl() {
  return process.env.REDIS_URL || 'redis://127.0.0.1:6379';
}

async function getClient() {
  if (client && client.isOpen) return client;

  client = createClient({ url: getRedisUrl() });

  client.on('error', (err) => {
    logger.error({ type: 'REDIS_ERROR', error: err?.message || err }, 'Redis error');
  });

  if (!client.isOpen) {
    await client.connect();
    logger.info({ type: 'REDIS_CONNECTED', url: getRedisUrl() }, 'Redis connected');
  }

  return client;
}

async function getSubscriber() {
  if (subscriber && subscriber.isOpen) return subscriber;

  subscriber = createClient({ url: getRedisUrl() });

  subscriber.on('error', (err) => {
    logger.error({ type: 'REDIS_SUB_ERROR', error: err?.message || err }, 'Redis subscriber error');
  });

  if (!subscriber.isOpen) {
    await subscriber.connect();
    logger.info({ type: 'REDIS_SUB_CONNECTED' }, 'Redis subscriber connected');
  }

  return subscriber;
}

module.exports = {
  getClient,
  getSubscriber,
};
