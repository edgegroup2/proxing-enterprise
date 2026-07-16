'use strict';

const express = require('express');
const router = express.Router();

const authModule = require('../middleware/auth');
const db = require('../db');
const { transferBetweenUsers } = require('../services/walletService');

const authMiddleware =
  typeof authModule === 'function'
    ? authModule
    : (
        authModule.requireAuth ||
        authModule.authMiddleware ||
        authModule.auth ||
        authModule.userAuth ||
        authModule.default
      );

if (typeof authMiddleware !== 'function') {
  throw new Error(
    `Auth middleware is not a function. Exported keys: ${Object.keys(authModule || {}).join(', ')}`
  );
}

function normalizeAmount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStatus(value) {
  return String(value || 'success').toLowerCase();
}

function normalizeType(value) {
  return String(value || '').toLowerCase();
}

function normalizeChannel(value) {
  return String(value || 'wallet').toLowerCase();
}

function normalizeMeta(meta) {
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
}

function deriveChannel(row) {
  return normalizeChannel(
    row.channel ||
    row.meta_channel ||
    row.tx_channel ||
    row.provider ||
    'wallet'
  );
}

function deriveProductType(row) {
  const meta = normalizeMeta(row.meta);

  const productType =
    meta.product_type ||
    meta.productType ||
    row.product_type ||
    row.tx_type ||
    null;

  if (productType) {
    return String(productType).toLowerCase();
  }

  const provider = String(row.provider || '').toLowerCase();
  const type = String(row.type || '').toLowerCase();

  if (provider === 'paystack' || provider === 'monnify') {
    return 'wallet_funding';
  }

  if (provider === 'vtpass-refund') {
    return 'refund';
  }

  if (provider === 'vtpass') {
    return 'utility';
  }

  if (type === 'credit') return 'wallet_credit';
  if (type === 'debit') return 'wallet_debit';

  return 'wallet';
}

function buildNarration(row) {
  const productType = deriveProductType(row);
  const type = normalizeType(row.type);
  const provider = String(row.provider || '').toLowerCase();

  if (productType === 'wallet_funding') {
    return type === 'credit' ? 'Wallet funding' : 'Wallet funding reversal';
  }

  if (productType === 'wallet_transfer') {
    return type === 'credit' ? 'Wallet transfer received' : 'Wallet transfer sent';
  }

  if (productType === 'airtime') return 'Airtime purchase';
  if (productType === 'data') return 'Data purchase';
  if (productType === 'tv') return 'TV subscription';
  if (productType === 'electricity') return 'Electricity purchase';
  if (productType === 'waec-registration') return 'WAEC Registration PIN purchase';
  if (productType === 'waec') return 'WAEC purchase';
  if (productType === 'international-airtime') return 'International airtime';
  if (productType === 'escrow') return 'Escrow transaction';
  if (productType === 'refund') return 'Refund';

  if (provider === 'vtpass-refund') return 'Utility refund';
  if (provider === 'vtpass') return 'Utility purchase';

  return type === 'credit' ? 'Wallet credit' : 'Wallet debit';
}

async function fetchWallet(userId) {
  const { rows } = await db.query(
    `
      SELECT
        id,
        user_id,
        balance,
        available_balance,
        locked_balance,
        currency,
        created_at,
        updated_at
      FROM wallets
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (!rows.length) return null;

  const row = rows[0];

  return {
    id: row.id,
    user_id: row.user_id,
    balance: normalizeAmount(row.balance),
    available_balance: normalizeAmount(row.available_balance),
    locked_balance: normalizeAmount(row.locked_balance),
    currency: row.currency || 'NGN',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function fetchWalletHistory(userId, limit = 20) {
  const { rows } = await db.query(
    `
      SELECT
        t.id,
        t.user_id,
        t.type,
        t.amount,
        t.provider,
        t.status,
        t.reference,
        t.channel,
        t.meta,
        t.service_id,
        t.phone,
        t.created_at,
        t.updated_at,

        COALESCE(t.meta->>'product_type', t.meta->>'productType') AS product_type,
        COALESCE(t.meta->>'service_id', t.meta->>'serviceID', t.service_id) AS meta_service_id,
        COALESCE(t.meta->>'channel', t.channel) AS meta_channel,
        COALESCE(t.meta->>'phone', t.meta->>'phoneNumber', t.phone) AS meta_phone,

        et.transaction_reference AS electricity_reference,
        et.disco,
        et.meter_number,
        et.token,
        et.units

      FROM transactions t
      LEFT JOIN electricity_tokens et
        ON et.transaction_reference = t.reference
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return rows.map((row) => {
    const productType = deriveProductType(row);
    const channel = deriveChannel(row);

    return {
      id: row.id,
      user_id: row.user_id,
      type: normalizeType(row.type),
      amount: normalizeAmount(row.amount),
      status: normalizeStatus(row.status),
      provider: row.provider || 'system',
      reference: row.reference,
      channel,
      product_type: productType,
      service_id: row.meta_service_id || null,
      phone: row.meta_phone || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      meta: normalizeMeta(row.meta),
      narration: buildNarration(row),
      electricity:
        productType === 'electricity' && row.electricity_reference
          ? {
              transaction_reference: row.electricity_reference,
              disco: row.disco || null,
              meter_number: row.meter_number || null,
              token: row.token || null,
              units:
                row.units !== undefined && row.units !== null
                  ? Number(row.units)
                  : null,
            }
          : null,
    };
  });
}

/**
 * GET AUTHENTICATED USER WALLET
 * source of truth: wallets table
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const wallet = await fetchWallet(req.user.id);

    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: 'Wallet not found',
      });
    }

    return res.json({
      success: true,
      data: wallet,
    });
  } catch (err) {
    console.error('Wallet fetch error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch wallet',
    });
  }
});

/**
 * GET WALLET HISTORY / RECENT TRANSACTIONS
 * source of truth: transactions table
 */
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const data = await fetchWalletHistory(req.user.id, limit);

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error('Wallet history fetch error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch wallet history',
    });
  }
});

/**
 * optional alias for frontend compatibility
 */
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const data = await fetchWalletHistory(req.user.id, limit);

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error('Wallet transactions fetch error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch wallet transactions',
    });
  }
});

/**
 * INTERNAL WALLET TRANSFER
 * POST /api/wallet/transfer
 */
router.post('/transfer', authMiddleware, async (req, res) => {
  try {
    const senderUserId = req.user.id;
    const {
      recipientUserId,
      recipientPhone,
      amount,
      narration,
    } = req.body || {};

    let resolvedRecipientUserId = recipientUserId || null;

    if (!resolvedRecipientUserId && recipientPhone) {
      const normalizedPhone = String(recipientPhone).replace(/\D/g, '');

      const recipientRes = await db.query(
        `
          SELECT id, phone
          FROM users
          WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = $1
          LIMIT 1
        `,
        [normalizedPhone]
      );

      if (!recipientRes.rows.length) {
        return res.status(404).json({
          success: false,
          error: 'Recipient not found',
        });
      }

      resolvedRecipientUserId = recipientRes.rows[0].id;
    }

    if (!resolvedRecipientUserId) {
      return res.status(400).json({
        success: false,
        error: 'recipientUserId or recipientPhone is required',
      });
    }

    const numericAmount = Number(amount);
    if (!numericAmount || Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid amount is required',
      });
    }

    const result = await transferBetweenUsers({
      senderUserId,
      recipientUserId: resolvedRecipientUserId,
      amount: numericAmount,
      narration: String(narration || 'Wallet transfer').trim(),
    });

    return res.json({
      success: true,
      message: 'Transfer successful',
      data: result,
    });
  } catch (err) {
    console.error('Wallet transfer error:', err);

    const message = err.message || 'Transfer failed';

    if (
      message === 'senderUserId and recipientUserId required' ||
      message === 'Cannot transfer to self' ||
      message === 'Invalid amount' ||
      message === 'Sender wallet not found' ||
      message === 'Recipient wallet not found' ||
      message === 'Insufficient balance'
    ) {
      return res.status(400).json({
        success: false,
        error: message,
      });
    }

    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

module.exports = router;
