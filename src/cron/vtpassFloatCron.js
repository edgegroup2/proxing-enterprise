'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { evaluateFloatHealth, attemptAutoTopup } = require('../services/vtpassFloatManager');

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

let dailyTotal = 0;
let dailyCount = 0;
let lastReset = new Date().toDateString();

function resetDailyIfNeeded() {
  const today = new Date().toDateString();
  if (today !== lastReset) {
    dailyTotal = 0;
    dailyCount = 0;
    lastReset = today;
  }
}

function startVtpassFloatCron() {
  const enabled = String(process.env.ENABLE_CRONS || 'false') === 'true';
  if (!enabled) {
    logger.info({ type: 'CRON_DISABLED' }, 'VTPass float cron disabled by ENV');
    return;
  }

  // cluster guard
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') {
    logger.info({ type: 'CRON_CLUSTER_GUARD', instance: process.env.NODE_APP_INSTANCE }, 'Float cron disabled on this instance');
    return;
  }

  // every 2 mins
  cron.schedule('*/2 * * * *', async () => {
    try {
      resetDailyIfNeeded();

      const health = await evaluateFloatHealth();

      logger.info(
        {
          type: 'VTPASS_FLOAT_HEALTH',
          balance: health.balance,
          okForPurchase: health.okForPurchase,
          shouldTopup: health.shouldTopup,
          MIN: health.MIN_BALANCE,
          HARD_STOP: health.HARD_STOP,
          dailyTotal,
          dailyCount,
        },
        'VTpass float health check'
      );

      if (!health.shouldTopup) return;

      const topupAmount = num(process.env.VTPASS_TOPUP_AMOUNT, 20_000);
      const DAILY_LIMIT = num(process.env.VTPASS_DAILY_TOPUP_LIMIT, 100_000);
      const MAX_TRANSFERS = num(process.env.VTPASS_MAX_TRANSFERS_PER_DAY, 5);

      if (dailyTotal + topupAmount > DAILY_LIMIT) {
        logger.warn({ type: 'VTPASS_TOPUP_DAILY_LIMIT', dailyTotal, topupAmount, DAILY_LIMIT }, 'Daily topup limit reached');
        return;
      }

      if (dailyCount >= MAX_TRANSFERS) {
        logger.warn({ type: 'VTPASS_TOPUP_MAX_COUNT', dailyCount, MAX_TRANSFERS }, 'Max daily topup count reached');
        return;
      }

      const res = await attemptAutoTopup({ amount: topupAmount });

      if (res.toppedUp) {
        dailyTotal += topupAmount;
        dailyCount += 1;
        logger.info({ type: 'VTPASS_TOPUP_TRIGGERED', provider: res.provider, topupAmount, dailyTotal, dailyCount }, 'Auto topup triggered');
      } else {
        logger.info({ type: 'VTPASS_TOPUP_SKIPPED', reason: res.reason }, 'Auto topup skipped');
      }
    } catch (err) {
      logger.error({ type: 'VTPASS_FLOAT_CRON_ERROR', error: err.message, stack: err.stack }, 'VTPass float cron error');
    }
  });

  logger.info({ type: 'VTPASS_FLOAT_CRON_STARTED' }, 'VTpass float cron scheduled (every 2 mins)');
}

module.exports = { startVtpassFloatCron };
