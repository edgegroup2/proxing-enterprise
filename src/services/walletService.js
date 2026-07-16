'use strict';

const db = require('../db');
const paystackProvider = require('../providers/paystackProvider');
const monnifyProvider = require('../providers/monnifyProvider');
const walletEngine = require('../engine/walletEngine');
const { emitWalletUpdate } = require('./walletRealtime');

/**
 * CHANNEL LOCK (ProxiNG supports 3 + internal)
 */
const ALLOWED_CHANNELS = new Set(['web', 'sms', 'telegram', 'wallet', 'system']);

/**
 * TYPE LOCK
 */
const ALLOWED_DEBIT_TYPES = new Set([
  'purchase',
  'withdrawal',
  'wallet_transfer',
  'escrow-lock',
  'commission',
  'fee',
  'refund_reversal'
]);

const ALLOWED_CREDIT_TYPES = new Set([
  'credit',
  'funding',
  'refund',
  'wallet_transfer',
  'commission',
  'escrow-release'
]);

/**
 * NORMALIZERS
 */

function normalizeAmount(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeReference(ref) {
  return String(ref || '').trim();
}

function normalizeChannel(channel, fallback = 'system') {
  const c = String(channel || fallback).toLowerCase().trim();
  return ALLOWED_CHANNELS.has(c) ? c : fallback;
}

function normalizeProvider(p, fallback = 'system') {
  return String(p || fallback).toLowerCase().trim();
}

function normalizeType(type, fallback) {
  return String(type || fallback).toLowerCase().trim();
}

function normalizeMeta(meta = {}) {
  if (!meta || typeof meta !== 'object') return {};
  return meta;
}

/**
 * IMPORTANT: Ensure unified meta structure (VTpass compatible)
 */
function buildMeta(meta = {}) {
  const m = normalizeMeta(meta);

  return {
    ...m,
    channel: normalizeChannel(m.channel || 'system'),
    product_type: m.product_type || m.productType || null,
    productType: m.productType || m.product_type || null,
    service_id: m.service_id || m.serviceID || null,
    serviceID: m.serviceID || m.service_id || null,
    phone: m.phone || m.phoneNumber || null,
    phoneNumber: m.phoneNumber || m.phone || null,
  };
}

/**
 * REALTIME SAFE EMIT
 */
async function safeEmitWalletUpdate(userId, payload) {
  try {
    await emitWalletUpdate(userId, payload);
  } catch (_) {}
}

/**
 * =========================
 * FUNDING (UNCHANGED)
 * =========================
 */
async function initiateCardFunding(userId, payload = {}) {
  const amount = normalizeAmount(payload.amount);

  if (!userId) throw new Error('Unauthorized');
  if (!amount || amount <= 0) throw new Error('Invalid amount');

  return paystackProvider.initiateTransaction({
    email: payload.email || `user-${userId}@prox.ng`,
    amount: Math.round(amount * 100),
    metadata: {
      userId,
      phone: payload.phone || null,
      ...(payload.metadata || {})
    }
  });
}

async function createVirtualAccount(userId, payload = {}) {
  if (!userId) throw new Error('Unauthorized');

  const fn =
    monnifyProvider.createReservedAccount ||
    monnifyProvider.createReservedAccountStrict ||
    monnifyProvider.reserveAccount;

  if (typeof fn !== 'function') {
    throw new Error('No valid Monnify account creation method');
  }

  return fn({
    userId,
    email: payload.email,
    name: payload.name,
    bvn: payload.bvn,
    nin: payload.nin,
    preferredBanks: payload.preferredBanks
  });
}

/**
 * =========================
 * CREDIT WALLET
 * =========================
 */
async function creditWallet(
  userId,
  amount,
  reference,
  provider = 'system',
  meta = {},
  client = null
) {
  if (!userId) throw new Error('userId required');

  const amt = normalizeAmount(amount);
  const ref = normalizeReference(reference);

  if (!amt || amt <= 0) throw new Error('Invalid amount');
  if (!ref) throw new Error('Reference required');

  const safeMeta = buildMeta(meta);
  const channel = normalizeChannel(safeMeta.channel);

  const type = ALLOWED_CREDIT_TYPES.has(normalizeType(safeMeta.type, 'credit'))
    ? normalizeType(safeMeta.type, 'credit')
    : 'credit';

  const result = await walletEngine.credit({
    userId: String(userId),
    amount: amt,
    reference: ref,
    provider: normalizeProvider(provider),
    type,
    meta: safeMeta,
    client
  });

  await safeEmitWalletUpdate(userId, {
    reference: ref,
    channel,
    status: 'success',
    type: 'credit',
    amount: amt,
    meta: safeMeta
  });

  return result;
}

/**
 * =========================
 * DEBIT WALLET
 * =========================
 */
async function debitWallet(
  userId,
  amount,
  reference,
  type = 'purchase',
  provider = 'system',
  meta = {},
  client = null
) {
  if (!userId) throw new Error('userId required');

  const amt = normalizeAmount(amount);
  const ref = normalizeReference(reference);

  if (!amt || amt <= 0) throw new Error('Invalid amount');
  if (!ref) throw new Error('Reference required');

  const safeMeta = buildMeta(meta);
  const channel = normalizeChannel(safeMeta.channel);

  const normalizedType = ALLOWED_DEBIT_TYPES.has(normalizeType(type, 'purchase'))
    ? normalizeType(type, 'purchase')
    : 'purchase';

  const result = await walletEngine.debit({
    userId: String(userId),
    amount: amt,
    reference: ref,
    provider: normalizeProvider(provider),
    type: normalizedType,
    meta: safeMeta,
    client
  });

  await safeEmitWalletUpdate(userId, {
    reference: ref,
    channel,
    status: 'success',
    type: 'debit',
    amount: amt,
    meta: safeMeta
  });

  return result;
}

/**
 * =========================
 * WALLET TRANSFER (LOCKED)
 * =========================
 */
async function transferBetweenUsers({
  senderUserId,
  recipientUserId,
  amount,
  narration = 'Wallet transfer'
}) {
  if (!senderUserId || !recipientUserId) {
    throw new Error('Both users required');
  }

  if (String(senderUserId) === String(recipientUserId)) {
    throw new Error('Cannot transfer to self');
  }

  const amt = normalizeAmount(amount);
  if (!amt || amt <= 0) throw new Error('Invalid amount');

  const reference = `wt_${Date.now()}_${senderUserId}_${recipientUserId}`;
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const senderWallet = await client.query(
      `SELECT available_balance FROM wallets WHERE user_id = $1 FOR UPDATE`,
      [senderUserId]
    );

    if (!senderWallet.rowCount) throw new Error('Sender wallet not found');

const balance = Number(senderWallet.rows[0].available_balance);

if (!Number.isFinite(balance)) {
  throw new Error("Invalid wallet balance");
}

if (balance < amt) {
  throw new Error("Insufficient balance");
}

    const recipientWallet = await client.query(
      `SELECT id FROM wallets WHERE user_id = $1 LIMIT 1`,
      [recipientUserId]
    );

    if (!recipientWallet.rowCount) {
      throw new Error('Recipient wallet not found');
    }

    await debitWallet(
      senderUserId,
      amt,
      `${reference}-debit`,
      'wallet_transfer',
      'wallet',
      {
        to: recipientUserId,
        channel: 'wallet',
        service: 'transfer',
        product_type: 'wallet-transfer'
      },
      client
    );

    await creditWallet(
      recipientUserId,
      amt,
      `${reference}-credit`,
      'wallet',
      {
        from: senderUserId,
        channel: 'wallet',
        service: 'transfer',
        product_type: 'wallet-transfer'
      },
      client
    );

    await client.query('COMMIT');

    return {
      success: true,
      reference,
      amount: amt
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  initiateCardFunding,
  createVirtualAccount,
  creditWallet,
  debitWallet,
  transferBetweenUsers
};
