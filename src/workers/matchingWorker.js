'use strict';

const logger = require('../util/logger');
const { processNextQueuedRequest } = require('../services/matching/matchingService');

const POLL_INTERVAL_MS = Number(process.env.MATCHING_POLL_INTERVAL_MS || 2000);
let stopping = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function start() {
  logger.info({
    type: 'MATCHING_WORKER_STARTED',
    pollIntervalMs: POLL_INTERVAL_MS
  });

  while (!stopping) {
    try {
      const result = await processNextQueuedRequest();

      if (result?.empty) {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      logger.error({
        type: 'MATCHING_WORKER_LOOP_ERROR',
        error: error.message,
        stack: error.stack
      });

      await sleep(POLL_INTERVAL_MS);
    }
  }

  logger.info({
    type: 'MATCHING_WORKER_STOPPED'
  });
}

process.on('SIGINT', () => {
  stopping = true;
});

process.on('SIGTERM', () => {
  stopping = true;
});

start().catch((error) => {
  logger.error({
    type: 'MATCHING_WORKER_FATAL',
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});
