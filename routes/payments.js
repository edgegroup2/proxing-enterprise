'use strict';

const express = require('express');
const router = express.Router();

const walletService = require('../src/services/walletService');

/**
 * Optional auth middleware loader
 * Supports different export styles without crashing.
 */
let authMiddleware = null;
try {
  const authModule = require('../src/middleware/auth');
  authMiddleware =
    typeof authModule === 'function'
      ? authModule
      : (
          authModule.requireAuth ||
          authModule.authMiddleware ||
          authModule.auth ||
          authModule.userAuth ||
          authModule.default
        );
} catch (err) {
  console.warn('[payments] auth middleware load warning:', err.message);
}

if (typeof authMiddleware !== 'function') {
  authMiddleware = (req, res, next) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    // Minimal fallback so service still receives a user id shape
    req.user = req.user || { id: 'auth-user' };
    next();
  };
}

/**
 * Health
 * GET /api/payments/health
 */
router.get('/health', async (req, res) => {
  return res.json({
    success: true,
    status: 'OK',
    service: 'payments',
  });
});

/**
 * Start wallet funding with Paystack
 * POST /api/payments/wallet/fund/card
 *
 * Body:
 * {
 *   amount: 1000,
 *   email?: "...",
 *   metadata?: {...}
 * }
 */
router.post('/wallet/fund/card', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const result = await walletService.initiateCardFunding(userId, req.body || {});

    const authorizationUrl =
      result?.data?.authorization_url ||
      result?.authorization_url ||
      result?.data?.data?.authorization_url ||
      null;

    const accessCode =
      result?.data?.access_code ||
      result?.access_code ||
      result?.data?.data?.access_code ||
      null;

    const reference =
      result?.data?.reference ||
      result?.reference ||
      result?.data?.data?.reference ||
      null;

    const bankTransferDetails =
      result?.data?.bank_transfer ||
      result?.bank_transfer ||
      result?.data?.bank_transfer_details ||
      result?.bank_transfer_details ||
      null;

    return res.json({
      success: true,
      authorization_url: authorizationUrl,
      access_code: accessCode,
      reference,
      bank_transfer_details: bankTransferDetails,
      raw: result,
    });
  } catch (err) {
    console.error('[payments] wallet/fund/card error:', err.response?.data || err.message || err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to initiate wallet funding',
    });
  }
});

/**
 * Create/fetch Monnify reserved virtual account
 * POST /api/payments/wallet/virtual-account
 *
 * Body:
 * {
 *   email?: "...",
 *   name?: "...",
 *   bvn?: "...",
 *   nin?: "...",
 *   preferredBanks?: ["50515"]
 * }
 */
router.post('/wallet/virtual-account', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const result = await walletService.createVirtualAccount(userId, req.body || {});

    const accountNumber =
      result?.responseBody?.accounts?.[0]?.accountNumber ||
      result?.accountNumber ||
      result?.account_number ||
      result?.data?.accountNumber ||
      result?.data?.account_number ||
      '';

    const accountName =
      result?.responseBody?.accounts?.[0]?.accountName ||
      result?.accountName ||
      result?.account_name ||
      result?.data?.accountName ||
      result?.data?.account_name ||
      '';

    const bankName =
      result?.responseBody?.accounts?.[0]?.bankName ||
      result?.bankName ||
      result?.bank_name ||
      result?.data?.bankName ||
      result?.data?.bank_name ||
      'Monnify';

    return res.json({
      success: true,
      provider: 'monnify',
      accountNumber,
      accountName,
      bankName,
      account_number: accountNumber,
      account_name: accountName,
      bank_name: bankName,
      raw: result,
    });
  } catch (err) {
    console.error('[payments] wallet/virtual-account error:', err.response?.data || err.message || err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to create virtual account',
    });
  }
});

/**
 * Verify Paystack transaction
 * GET /api/payments/paystack/verify/:reference
 */
router.get('/paystack/verify/:reference', authMiddleware, async (req, res) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({
        success: false,
        error: 'Missing reference',
      });
    }

    const paystackProvider = require('../src/providers/paystackProvider');
    const result = await paystackProvider.verifyTransaction(reference);

    return res.json({
      success: true,
      status: result?.data?.status || result?.status || 'success',
      reference:
        result?.data?.reference ||
        result?.reference ||
        reference,
      amount:
        result?.data?.amount ||
        result?.amount ||
        null,
      raw: result,
    });
  } catch (err) {
    console.error('[payments] paystack verify error:', err.response?.data || err.message || err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to verify payment',
    });
  }
});

module.exports = router;
