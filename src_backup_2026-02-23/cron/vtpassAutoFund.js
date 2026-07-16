/**
 * VTPASS AUTO FUND CRON — PRODUCTION HARDENED
 */

const axios = require('axios');
const cron = require('node-cron');
const logger = require('../utils/logger');
const { sendTelegram } = require('../services/telegramService');
const { isFundingApproved } = require('../services/fundingControlService');

const MIN_BAL = Number(process.env.VTPASS_MIN_BALANCE || 50000);
const FUND_AMOUNT = Number(process.env.VTPASS_AUTO_FUND_AMOUNT || 10000);
const DAILY_LIMIT = Number(process.env.VTPASS_DAILY_TRANSFER_LIMIT || 200000);
const MAX_TRANSFERS = Number(process.env.VTPASS_MAX_TRANSFERS_PER_DAY || 5);

let dailyTotal = 0;
let dailyCount = 0;
let lastReset = new Date().toDateString();

let lowBalanceAlertSent = false;
let lastKnownBalance = null;

// ===============================
// RESET DAILY LIMITS
// ===============================

function resetDaily() {
  const today = new Date().toDateString();
  if (today !== lastReset) {
    dailyTotal = 0;
    dailyCount = 0;
    lastReset = today;
  }
}

// ===============================
// FETCH VTPASS BALANCE
// ===============================

async function getVtpassBalance() {
  const res = await axios.get(
    `${process.env.VTPASS_BASE_URL}/balance`,
    {
      headers: {
        'api-key': process.env.VTPASS_API_KEY,
        'public-key': process.env.VTPASS_PUBLIC_KEY,
        'secret-key': process.env.VTPASS_SECRET_KEY
      },
      timeout: 15000
    }
  );

  return Number(res.data?.content?.balance || 0);
}

// ===============================
// AUTO FUND (MONNIFY)
// ===============================

async function fundViaMonnify(amount) {
  await sendTelegram(
    `⚠️ <b>VTPass Auto-Funding Triggered</b>\nAmount: ₦${amount.toLocaleString()}`
  );

  // NOTE:
  // Real funding happens via reserved account transfer.
  // No direct VTPass funding API exists.
  return true;
}

// ===============================
// MAIN CRON
// ===============================

function startVtpassAutoFund() {
  if (process.env.ENABLE_CRONS !== 'true') return;

  cron.schedule('*/10 * * * *', async () => {
    try {
      resetDaily();

      if (!(await isFundingApproved())) return;

      const balance = await getVtpassBalance();
      lastKnownBalance = balance;

      // Structured log
      logger.info({
        service: 'vtpass',
        event: 'balance_check',
        balance,
        threshold: MIN_BAL
      });

      // ----------------------------
      // HEALTHY BALANCE
      // ----------------------------
      if (balance >= MIN_BAL) {
        if (lowBalanceAlertSent) {
          await sendTelegram(
            `✅ <b>VTPass Balance Recovered</b>\nCurrent: ₦${balance.toLocaleString()}`
          );
          lowBalanceAlertSent = false;
        }
        return;
      }

      // ----------------------------
      // LOW BALANCE ALERT
      // ----------------------------
      if (!lowBalanceAlertSent) {
        await sendTelegram(
          `🚨 <b>VTPass Low Balance Alert</b>\nCurrent: ₦${balance.toLocaleString()}\nThreshold: ₦${MIN_BAL.toLocaleString()}`
        );
        lowBalanceAlertSent = true;
      }

      // ----------------------------
      // DAILY LIMIT CHECKS
      // ----------------------------
      if (dailyTotal + FUND_AMOUNT > DAILY_LIMIT) return;
      if (dailyCount >= MAX_TRANSFERS) return;

      // ----------------------------
      // AUTO FUND
      // ----------------------------
      await fundViaMonnify(FUND_AMOUNT);

      dailyTotal += FUND_AMOUNT;
      dailyCount += 1;

    } catch (err) {
      logger.error('VTPass auto-fund error:', err.message);
      await sendTelegram(`❌ VTPass Auto-Fund Error: ${err.message}`);
    }
  });
}

module.exports = { startVtpassAutoFund };
