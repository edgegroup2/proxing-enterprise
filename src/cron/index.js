'use strict';

const logger = require('../utils/logger');

function logInfo(obj, msg) {
  try {
    logger.info(obj, msg);
  } catch (_) {
    console.log(msg || '', obj);
  }
}

function logError(obj, msg) {
  try {
    logger.error(obj, msg);
  } catch (_) {
    console.error(msg || '', obj);
  }
}

function safeLoad(name, path, exportName) {
  try {
    const mod = require(path);
    const fn = exportName ? mod?.[exportName] : mod;

    logInfo({
      type: 'CRON_MODULE_LOAD',
      name,
      path,
      exportName,
      moduleType: typeof mod,
      fnType: typeof fn,
      keys: mod && typeof mod === 'object' ? Object.keys(mod) : [],
    }, `🧩 CRON_MODULE_LOAD ${name}`);

    return typeof fn === 'function' ? fn : null;
  } catch (e) {
    logError({
      type: 'CRON_MODULE_LOAD_FAILED',
      name,
      path,
      exportName,
      error: e.message,
      stack: e.stack,
    }, `❌ CRON_MODULE_LOAD_FAILED ${name}`);
    return null;
  }
}

function safeStart(name, fn) {
  if (typeof fn !== 'function') {
    logError({ type: 'CRON_SKIP', name }, `⚠️ CRON_SKIP ${name} not a function`);
    return;
  }

  try {
    logInfo({ type: 'CRON_STARTING', name }, `🚀 CRON_STARTING ${name}`);
    fn();
    logInfo({ type: 'CRON_STARTED', name }, `✅ CRON_STARTED ${name}`);
  } catch (e) {
    logError({
      type: 'CRON_START_FAILED',
      name,
      error: e.message,
      stack: e.stack,
    }, `❌ CRON_START_FAILED ${name}`);
  }
}

function initialiseCron() {
  const enabled = String(process.env.ENABLE_CRONS || 'false') === 'true';

  logInfo({
    type: 'INITIALISE_CRON_ENTERED',
    enabled,
    ENABLE_CRONS: process.env.ENABLE_CRONS,
    NODE_APP_INSTANCE: process.env.NODE_APP_INSTANCE,
    cwd: process.cwd(),
    file: __filename,
  }, '🔎 INITIALISE_CRON_ENTERED');

  if (!enabled) {
    logInfo({ type: 'CRON_DISABLED' }, 'Cron disabled by ENV');
    return;
  }

  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') {
    logInfo({
      type: 'CRON_CLUSTER_GUARD',
      instance: process.env.NODE_APP_INSTANCE,
    }, 'Cron disabled on this instance');
    return;
  }

  const startVtpassFloatCron = safeLoad('vtpassFloatCron', './vtpassFloatCron', 'startVtpassFloatCron');
  const startVtpassAutoFund = safeLoad('vtpassAutoFund', './vtpassAutoFund', 'startVtpassAutoFund');
  const startHeartbeat = safeLoad('heartbeat', './heartbeat', 'startHeartbeat');
  const startDailyRevenueReport = safeLoad('dailyRevenueReport', './dailyRevenueReport', 'startDailyRevenueReport');
  const startReconciliationCron = safeLoad('reconciliationCron', './reconciliationCron', 'startReconciliationCron');
  const startServerMonitor = safeLoad('serverMonitor', './serverMonitor', 'startServerMonitor');
  const startTokenRecoveryCron = safeLoad('tokenRecoveryCron', './tokenRecoveryCron', 'startTokenRecoveryCron');
const runSeedMissingTopics = safeLoad(
  'seedMissingTopicsWorker',
  '../workers/seedMissingTopicsWorker',
  'runSeedMissingTopics'
);
  safeStart('vtpassFloatCron', startVtpassFloatCron);
  safeStart('vtpassAutoFund', startVtpassAutoFund);
  safeStart('heartbeat', startHeartbeat);
  safeStart('dailyRevenueReport', startDailyRevenueReport);
  safeStart('reconciliationCron', startReconciliationCron);
  safeStart('serverMonitor', startServerMonitor);
  safeStart('tokenRecoveryCron', startTokenRecoveryCron);

if (typeof runSeedMissingTopics === 'function') {
  safeStart('seedMissingTopicsWorker', () => {
    runSeedMissingTopics().catch((err) => {
      logError(
        {
          type: 'SEED_MISSING_TOPICS_FAILED',
          error: err.message,
          stack: err.stack,
        },
        '[SEED_MISSING_TOPICS_FAILED]'
      );
    });

    setInterval(() => {
      runSeedMissingTopics().catch((err) => {
        logError(
          {
            type: 'SEED_MISSING_TOPICS_FAILED',
            error: err.message,
            stack: err.stack,
          },
          '[SEED_MISSING_TOPICS_FAILED]'
        );
      });
    }, 10 * 60 * 1000);
  });
}

  logInfo({ type: 'CRON_INIT_DONE' }, '✅ All cron jobs initialised');
}

module.exports = initialiseCron;
module.exports.initialiseCron = initialiseCron;
