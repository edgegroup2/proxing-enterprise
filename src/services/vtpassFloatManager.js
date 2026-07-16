'use strict';

/**
 * VTPASS FLOAT MANAGER (CONSERVATIVE SCALING)
 * ------------------------------------------
 * Goal: low VTpass float + frequent small topups (safer cash management).
 *
 * Key envs:
 *  - VTPASS_AUTOTOPUP_ENABLED=true/false
 *  - VTPASS_TOPUP_PROVIDER=monnify|paystack
 *
 * Thresholds (naira):
 *  - VTPASS_MIN_BALANCE=50000        => if balance < MIN => eligible to topup
 *  - VTPASS_HARD_STOP_BALANCE=20000  => if balance < HARD_STOP => block purchases
 *
 * Topup sizing (conservative):
 *  - VTPASS_TARGET_BALANCE=80000     => top up only to reach TARGET (not huge)
 *  - VTPASS_MIN_TOPUP_AMOUNT=5000    => don't send microscopic amounts
 *  - VTPASS_MAX_TOPUP_AMOUNT=30000   => limit each topup (conservative)
 *
 * Safety caps:
 *  - VTPASS_MAX_TRANSFERS_PER_DAY=10
 *  - VTPASS_DAILY_TRANSFER_LIMIT=100000
 *  - VTPASS_TOPUP_COOLDOWN_MS=300000 (5 minutes)
 *
 * Optional Paystack:
 *  - VTPASS_PAYSTACK_RECIPIENT_CODE=...
 *  - VTPASS_FUND_ACCOUNT_NUMBER=...
 *  - VTPASS_FUND_ACCOUNT_NAME=...
 *  - VTPASS_FUND_BANK_CODE=...
 */

const logger = require('../utils/logger');
const vtpassClient = require('./vtpassClient');

let monnifyDisbursement = null;
try {
  monnifyDisbursement = require('./monnifyDisbursement');
} catch (_) {}

let paystackPayout = null;
try {
  paystackPayout = require('./paystackPayoutService');
} catch (_) {}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function envBool(name, def = 'false') {
  return String(process.env[name] ?? def).toLowerCase() === 'true';
}

function str(v, d = '') {
  const s = String(v ?? '').trim();
  return s || d;
}

function clamp(n, minV, maxV) {
  return Math.max(minV, Math.min(maxV, n));
}

/**
 * Reads VTpass balance response and normalizes to number.
 * Your successful sample: { code: 1, contents: { balance: "98708.20" } }
 */
async function fetchVtpassBalanceNaira() {
  const raw = await vtpassClient.getWalletBalance();

  const possible =
    raw?.contents?.balance ??
    raw?.content?.balance ??
    raw?.responseBody?.balance ??
    raw?.balance ??
    null;

  const balance = num(possible, 0);
  return { balance, raw };
}

/**
 * Float health:
 * okForPurchase: balance >= HARD_STOP
 * shouldTopup:   balance < MIN
 */
async function evaluateFloatHealth() {
  const { balance, raw } = await fetchVtpassBalanceNaira();

  const MIN_BALANCE = num(process.env.VTPASS_MIN_BALANCE, 50_000);
  const HARD_STOP = num(process.env.VTPASS_HARD_STOP_BALANCE, 20_000);

  const okForPurchase = balance >= HARD_STOP;
  const shouldTopup = balance < MIN_BALANCE;

  return {
    balance,
    okForPurchase,
    shouldTopup,
    MIN_BALANCE,
    HARD_STOP,
    raw,
  };
}

/**
 * Computes conservative topup amount:
 * - If balance < MIN, top up to TARGET (small target)
 * - amount = TARGET - balance
 * - clamp between MIN_TOPUP and MAX_TOPUP
 */
function computeTopupAmount(balance) {
  const TARGET = num(process.env.VTPASS_TARGET_BALANCE, 80_000);
  const MIN_TOPUP = num(process.env.VTPASS_MIN_TOPUP_AMOUNT, 5_000);
  const MAX_TOPUP = num(process.env.VTPASS_MAX_TOPUP_AMOUNT, 30_000);

  const needed = Math.max(0, TARGET - balance);
  if (needed <= 0) return 0;

  // If "needed" is tiny (e.g. 500), bump to MIN_TOPUP
  return clamp(needed, MIN_TOPUP, MAX_TOPUP);
}

/**
 * Basic in-memory state for cooldown and daily caps (per running process).
 * If you want persistence across restarts, we can store in DB later.
 */
let dailyTotal = 0;
let dailyCount = 0;
let lastReset = new Date().toDateString();
let lastTopupAt = 0;

function resetDailyIfNeeded() {
  const today = new Date().toDateString();
  if (today !== lastReset) {
    dailyTotal = 0;
    dailyCount = 0;
    lastReset = today;
  }
}

function canTopupNow(amount) {
  resetDailyIfNeeded();

  const DAILY_LIMIT = num(process.env.VTPASS_DAILY_TRANSFER_LIMIT, 100_000);
  const MAX_TRANSFERS = num(process.env.VTPASS_MAX_TRANSFERS_PER_DAY, 10);
  const COOLDOWN_MS = num(process.env.VTPASS_TOPUP_COOLDOWN_MS, 300_000);

  const now = Date.now();
  if (now - lastTopupAt < COOLDOWN_MS) {
    return { ok: false, reason: 'COOLDOWN_ACTIVE' };
  }
  if (dailyCount >= MAX_TRANSFERS) {
    return { ok: false, reason: 'MAX_TRANSFERS_REACHED' };
  }
  if (dailyTotal + amount > DAILY_LIMIT) {
    return { ok: false, reason: 'DAILY_LIMIT_REACHED' };
  }

  return { ok: true };
}

async function topupViaMonnify({ amount, reference }) {
  if (!monnifyDisbursement) throw new Error('monnifyDisbursement not available');

  // Your monnifyDisbursement.js earlier showed a function transferToVtpass(amount)
  // We'll support either transferToVtpass(amount) OR initiateTransfer(payload)
  if (typeof monnifyDisbursement.transferToVtpass === 'function') {
    return monnifyDisbursement.transferToVtpass(amount, reference);
  }

  // fallback: common payload style
  if (typeof monnifyDisbursement.initiateTransfer === 'function') {
    const payload = {
      amount,
      reference,
      narration: `VTpass Float Topup ${reference}`,
      destinationAccountNumber: process.env.VTPASS_FUND_ACCOUNT_NUMBER,
      destinationAccountName: process.env.VTPASS_FUND_ACCOUNT_NAME,
      destinationBankCode: process.env.VTPASS_FUND_BANK_CODE,
      // sourceAccountNumber usually comes from MONNIFY_CONTRACT_CODE in your disbursement service
    };
    return monnifyDisbursement.initiateTransfer(payload);
  }

  throw new Error('monnifyDisbursement does not export transferToVtpass/initiateTransfer');
}

async function topupViaPaystack({ amount, reference }) {
  if (!paystackPayout) throw new Error('paystackPayoutService not available');

  // Requires recipient code configured in Paystack
  const recipientCode = str(process.env.VTPASS_PAYSTACK_RECIPIENT_CODE, '');
  if (!recipientCode) {
    throw new Error('Missing VTPASS_PAYSTACK_RECIPIENT_CODE (create recipient on Paystack then set env)');
  }

  if (typeof paystackPayout.initiateTransfer !== 'function') {
    throw new Error('paystackPayoutService.initiateTransfer not found');
  }

  return paystackPayout.initiateTransfer({
    amount,
    recipient: recipientCode,
    reason: 'VTpass Float Topup',
    reference,
  });
}

/**
 * MAIN AUTO TOPUP FUNCTION (called by cron)
 */
async function attemptAutoTopup({ amount } = {}) {
  const enabled = envBool('VTPASS_AUTOTOPUP_ENABLED', 'false');
  if (!enabled) return { toppedUp: false, reason: 'AUTOTOPUP_DISABLED' };

  // Always re-check health live
  const health = await evaluateFloatHealth();

  // If no need to top up, exit
  if (!health.shouldTopup) {
    return { toppedUp: false, reason: 'NOT_REQUIRED', health };
  }

  // Determine amount if not provided
  const computedAmount = amount ? num(amount, 0) : computeTopupAmount(health.balance);
  if (computedAmount <= 0) {
    return { toppedUp: false, reason: 'AMOUNT_ZERO', health };
  }

  // Caps + cooldown
  const gate = canTopupNow(computedAmount);
  if (!gate.ok) {
    return { toppedUp: false, reason: gate.reason, health };
  }

  const provider = str(process.env.VTPASS_TOPUP_PROVIDER, 'monnify').toLowerCase();
  const reference = `vtpass_topup_${Date.now()}`;

  logger.info({
    type: 'VTPASS_AUTOTOPUP_TRIGGER',
    provider,
    amount: computedAmount,
    reference,
    balance: health.balance,
    minBalance: health.MIN_BALANCE,
    targetBalance: num(process.env.VTPASS_TARGET_BALANCE, 80_000),
    dailyTotal,
    dailyCount,
  });

  let res;
  if (provider === 'paystack') {
    res = await topupViaPaystack({ amount: computedAmount, reference });
  } else {
    // default monnify
    res = await topupViaMonnify({ amount: computedAmount, reference });
  }

  // Update state after success
  dailyTotal += computedAmount;
  dailyCount += 1;
  lastTopupAt = Date.now();

  logger.info({
    type: 'VTPASS_AUTOTOPUP_SENT',
    provider,
    amount: computedAmount,
    reference,
    dailyTotal,
    dailyCount,
    res,
  });

  return { toppedUp: true, provider, amount: computedAmount, reference, res, health };
}

module.exports = {
  evaluateFloatHealth,
  attemptAutoTopup,
  fetchVtpassBalanceNaira,
};
