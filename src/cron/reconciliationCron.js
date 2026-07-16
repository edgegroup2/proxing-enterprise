'use strict';

const service = require('../services/reconciliationService');
const logger = require('../util/logger');

async function startReconciliationCron() {
  const fn = service.reconcileVtpassBalance;

  if (typeof fn !== 'function') {
    logger.error({
      type: 'RECONCILIATION_CRON_MISSING_FUNCTION',
      keys: Object.keys(service || {}),
      actualType: typeof fn,
    });
    return null;
  }

  try {
    const balance = await fn();

    logger.info(
      { type: 'RECONCILIATION_OK', balance },
      'VTPass reconciliation check'
    );

    return balance;
  } catch (error) {
    logger.error({
      type: 'RECONCILIATION_CRON_FAILED',
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
}

module.exports = {
  startReconciliationCron,
  reconciliationCron: startReconciliationCron,
};
