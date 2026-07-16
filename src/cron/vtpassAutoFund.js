'use strict';

/**
 * VTPASS AUTO FUND CRON - PRODUCTION HARDENED
 * - Monitors VTPass wallet balance
 * - Alerts on low balance
 * - Optionally auto-funds VTPass wallet by initiating a bank transfer
 *   to VTPass funding account (via Monnify Disbursement or Paystack Transfers)
 *
 * Safety:
 * - ENV guard via ENABLE_CRONS
 * - Cluster guard
 * - Ops approval gate via isFundingApproved()
 * - Daily total + max transfers caps
 */

const axios = require('axios');
const cron = require('node-cron');
const logger = require('../utils/logger');
const { sendTelegram } = require('../services/telegramService');
const { isFundingApproved } = require('../services/fundingControlService');

// Optional disbursement service(s)
let monnifyDisbursement = null;
try {
  monnifyDisbursement = require('../services/monnifyDisbursement');
} catch (_) {}

let paystackPayout = null;
try {
  paystackPayout = require('../services/paystackPayoutService');
} catch (_) {}

// --------------------
// ENV DEFAULTS
// --------------------
const MIN_BAL = Number(process.env.VTPASS_MIN_BALANCE || 50000);
const FUND_AMOUNT = Number(process.env.VTPASS_AUTO_FUND_AMOUNT || 100000);
const DAILY_LIMIT = Number(process.env.VTPASS_DAILY_TRANSFER_LIMIT || 2000000);
const MAX_TRANSFERS = Number(process.env.VTPASS_MAX_TRANSFERS_PER_DAY || 5);

// monnify | paystack | manual
const AUTO_FUND_PROVIDER = String(process.env.VTPASS_AUTO_FUND_PROVIDER || 'monnify').toLowerCase();

// VTPass funding account details (destination)
const VTPASS_FUND_ACCOUNT_NUMBER = String(process.env.VTPASS_FUND_ACCOUNT_NUMBER || '6567667943');
const VTPASS_FUND_ACCOUNT_NAME = String(process.env.VTPASS_FUND_ACCOUNT_NAME || 'Nurudeen Ajibola Alliyu');
const VTPASS_FUND_BANK_NAME = String(process.env.VTPASS_FUND_BANK_NAME || 'Moniepoint Microfinance Bank');
const VTPASS_FUND_BANK_CODE = process.env.VTPASS_FUND_BANK_CODE || ''; // if required by payout API

// --------------------
// VTPASS API HELPERS
// --------------------
function getVtpassBaseUrl() {
  const raw = (process.env.VTPASS_BASE_URL || 'https://vtpass.com/api').trim();
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function getVtpassHeaders() {
  const apiKey = process.env.VTPASS_API_KEY;
  const secretKey = process.env.VTPASS_SECRET_KEY;
  const primaryKey = process.env.VTPASS_PRIMARY_KEY;

  if (!apiKey || !secretKey || !primaryKey) {
    throw new Error(
      'Missing VTPASS keys. Required: VTPASS_API_KEY, VTPASS_SECRET_KEY, VTPASS_PRIMARY_KEY'
    );
  }

  return {
    'Content-Type': 'application/json',
    'api-key': apiKey,
    'secret-key': secretKey,
    'primary-key': primaryKey,
  };
}

async function getVtpassBalance() {
  const base = getVtpassBaseUrl();
  const headers = getVtpassHeaders();

  const res = await axios.get(`${base}/balance`, { headers, timeout: 20000 });
  return Number(res?.data?.content?.balance || 0);
}

// --------------------
// STATE (daily caps)
// --------------------
let dailyTotal = 0;
let dailyCount = 0;
let lastReset = new Date().toDateString();
let lowBalanceAlertSent = false;

function resetDailyIfNeeded() {
  const today = new Date().toDateString();
  if (today !== lastReset) {
    dailyTotal = 0;
    dailyCount = 0;
    lastReset = today;
  }
}

// --------------------
// DISBURSEMENT PICKERS
// --------------------
function pickMonnifyTransferFn() {
  if (!monnifyDisbursement) return null;
  return (
    monnifyDisbursement.transferToVtPass ||
    monnifyDisbursement.initiateTransfer ||
    monnifyDisbursement.transfer ||
    monnifyDisbursement.send ||
    null
  );
}

function pickPaystackTransferFn() {
  if (!paystackPayout) return null;
  return (
    paystackPayout.initiateTransfer ||
    paystackPayout.transfer ||
    paystackPayout.send ||
    null
  );
}

async function fundViaMonnify(amount) {
  const fn = pickMonnifyTransferFn();
  if (!fn) {
    throw new Error(
      'Monnify disbursement service not found or does not export a supported transfer function'
    );
  }

  const reference = `vtpass_float_${Date.now()}`;

  const payload = {
    amount,
    narration: `VTPass Float Topup ${reference}`,
    reference,
    destinationAccountNumber: VTPASS_FUND_ACCOUNT_NUMBER,
    destinationAccountName: VTPASS_FUND_ACCOUNT_NAME,
    destinationBankName: VTPASS_FUND_BANK_NAME,
    destinationBankCode: VTPASS_FUND_BANK_CODE,
  };

  await sendTelegram(
    `⚠️ <b>VTPass Auto-Funding Triggered (Monnify)</b>\nAmount: ₦${amount.toLocaleString()}\nRef: ${reference}\nTo: ${VTPASS_FUND_ACCOUNT_NUMBER} (${VTPASS_FUND_BANK_NAME})`
  );

  const result = await fn(payload);
  return { reference, result };
}

async function fundViaPaystack(amount) {
  const fn = pickPaystackTransferFn();
  if (!fn) {
    throw new Error(
      'Paystack payout service not found or does not export a supported transfer function'
    );
  }

  const reference = `vtpass_float_${Date.now()}`;

  const payload = {
    amount,
    narration: `VTPass Float Topup ${reference}`,
    reference,
    destinationAccountNumber: VTPASS_FUND_ACCOUNT_NUMBER,
    destinationAccountName: VTPASS_FUND_ACCOUNT_NAME,
    destinationBankName: VTPASS_FUND_BANK_NAME,
    destinationBankCode: VTPASS_FUND_BANK_CODE,
  };

  await sendTelegram(
    `⚠️ <b>VTPass Auto-Funding Triggered (Paystack)</b>\nAmount: ₦${amount.toLocaleString()}\nRef: ${reference}\nTo: ${VTPASS_FUND_ACCOUNT_NUMBER} (${VTPASS_FUND_BANK_NAME})`
  );

  const result = await fn(payload);
  return { reference, result };
}

async function performAutoFund(amount) {
  if (AUTO_FUND_PROVIDER === 'paystack') return fundViaPaystack(amount);
  if (AUTO_FUND_PROVIDER === 'monnify') return fundViaMonnify(amount);

  // manual mode: alert only
  await sendTelegram(
    `⛔ <b>VTPass Auto-Fund is in MANUAL mode</b>\nLow balance detected.\nSuggested topup: ₦${amount.toLocaleString()}`
  );
  return { reference: null, result: { manual: true } };
}

// --------------------
// MAIN CRON
// --------------------
function startVtpassAutoFund() {
  const enabled = String(process.env.ENABLE_CRONS || 'false') === 'true';
  if (!enabled) return;

  // cluster guard (pm2 safe)
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') return;

  // Every 10 minutes (Africa/Lagos is server TZ-dependent; schedule is okay)
  cron.schedule('*/10 * * * *', async () => {
    try {
      resetDailyIfNeeded();

      // ops approval gate
      if (!(await isFundingApproved())) return;

      const balance = await getVtpassBalance();

      logger.info(
        {
          service: 'vtpass',
          event: 'balance-check',
          balance,
          threshold: MIN_BAL,
          provider: AUTO_FUND_PROVIDER,
          dailyTotal,
          dailyCount,
        },
        'VTPASS_FLOAT_CHECK'
      );

      // healthy recovery message
      if (balance >= MIN_BAL) {
        if (lowBalanceAlertSent) {
          await sendTelegram(`✅ <b>VTPass Balance Recovered</b>\nCurrent: ₦${balance.toLocaleString()}`);
        }
        lowBalanceAlertSent = false;
        return;
      }

      // low balance alert (once)
      if (!lowBalanceAlertSent) {
        await sendTelegram(
          `⚠️ <b>VTPass Balance Alert</b>\nCurrent: ₦${balance.toLocaleString()}\nThreshold: ₦${MIN_BAL.toLocaleString()}`
        );
        lowBalanceAlertSent = true;
      }

      // daily caps
      if (dailyTotal + FUND_AMOUNT > DAILY_LIMIT) return;
      if (dailyCount >= MAX_TRANSFERS) return;

      // trigger auto funding
      const r = await performAutoFund(FUND_AMOUNT);
      dailyTotal += FUND_AMOUNT;
      dailyCount += 1;

      logger.info(
        {
          service: 'vtpass',
          event: 'auto-fund-triggered',
          amount: FUND_AMOUNT,
          reference: r.reference,
          dailyTotal,
          dailyCount,
          provider: AUTO_FUND_PROVIDER,
        },
        'VTPASS_AUTO_FUND_TRIGGERED'
      );
    } catch (err) {
      logger.error(
        { err: err?.message || err, stack: err?.stack },
        'VTPASS_AUTO_FUND_ERROR'
      );
      try {
        await sendTelegram(`❌ <b>VTPass Auto-Fund Error</b>\n${err?.message || String(err)}`);
      } catch (_) {}
    }
  });
}

module.exports = { startVtpassAutoFund };
