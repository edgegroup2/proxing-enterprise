'use strict';

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const db = require('../db');

const router = express.Router();

const walletEngine = require('../engine/walletEngine');
const { assertCardFundingWithinLimit } = require('../services/fundingLimitService');
const logger = require('../utils/logger');
const authModule = require('../middleware/auth');
const {
  upsertPendingFunding,
  markFundingSuccess,
  markFundingFailed,
  getFundingByReference,
} = require('../services/fundingService');

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

const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://proxing.online';
const MAX_CARD_FUNDING = Number(process.env.MAX_CARD_FUNDING || 20000);

function buildFallbackEmail(userId) {
  return `user-${String(userId).slice(0, 8)}@proxing.online`;
}

function normalizeAmountFromPaystackKobo(amountInKobo) {
  const amount = Number(amountInKobo) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount;
}

function resolveReferencePrefix(reference) {
  return `paystack_${reference}`;
}

function extractUserIdFromMetadata(metadata) {
  if (!metadata) return null;

  return (
    metadata.user_id ||
    metadata.userId ||
    metadata.userid ||
    metadata.user?.id ||
    metadata.customer_id ||
    null
  );
}

function extractWalletSettlementContext(data) {
  const reference = data?.reference || null;
  const amount = normalizeAmountFromPaystackKobo(data?.amount);
  const metadata = data?.metadata || {};
  const dedicatedAccount = data?.dedicated_account || null;

  return {
    reference,
    amount,
    metadata,
    dedicatedAccount,
  };
}

function pickFirstTruthy(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return v;
    }
  }
  return null;
}

function normalizeAccountNumber(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, '').trim();
  return s || null;
}

async function resolveUserIdForSettlement({ metadata, dedicatedAccount, authorization, paystackData }) {
const database = db; // ✅ FIX: bind db into function scope
  let userId = extractUserIdFromMetadata(metadata);
  if (userId) return String(userId);

  const accountNumber = normalizeAccountNumber(
    pickFirstTruthy(
      dedicatedAccount?.account_number,
      dedicatedAccount?.accountNumber,
      authorization?.receiver_bank_account_number,
      authorization?.receiverBankAccountNumber,
      paystackData?.dedicated_account?.account_number,
      paystackData?.dedicated_account?.accountNumber,
      paystackData?.customer?.metadata?.account_number,
      paystackData?.customer?.metadata?.accountNumber,
      paystackData?.recipient?.details?.account_number,
      paystackData?.recipient?.details?.accountNumber,
      paystackData?.authorization?.receiver_bank_account_number,
      paystackData?.authorization?.receiverBankAccountNumber
    )
  );

  if (!accountNumber) return null;

const wallet = await walletEngine.findByAccountNumber(accountNumber);
if (wallet?.user_id) return String(wallet.user_id);

// 1) Check virtual_accounts first (Paystack / Monnify VA source of truth)
const va = await database.query(
  `
    SELECT user_id
    FROM virtual_accounts
    WHERE REPLACE(TRIM(account_number), ' ', '') = $1
    LIMIT 1
  `,
  [accountNumber]
);

if (va.rowCount > 0) {
  return String(va.rows[0].user_id);
}

// 2) Fallback: check users table Paystack VA column
const userVa = await database.query(
  `
    SELECT id
    FROM users
    WHERE REPLACE(TRIM(paystack_va_account_number), ' ', '') = $1
    LIMIT 1
  `,
  [accountNumber]
);

if (userVa.rowCount > 0) {
  return String(userVa.rows[0].id);
}

// 3) Optional legacy fallback: reserved_accounts
const reserved = await database.query(
  `
    SELECT user_id
    FROM reserved_accounts
    WHERE REPLACE(TRIM(account_number), ' ', '') = $1
    LIMIT 1
  `,
  [accountNumber]
);

if (reserved.rowCount > 0) {
  return String(reserved.rows[0].user_id);
}

return null;
}

/**
 * Single settlement function used by:
 * - webhook
 * - verify endpoint fallback
 *
 * Idempotency strategy:
 * - always ensure a funding row exists first
 * - use one immutable wallet reference per payment
 * - if funding row is already processed successfully, return without re-crediting
 * - actual credit finality is delegated to fundingService / wallet layer
 */
async function settlePaystackPayment({
  paystackData,
  source = 'verify',
  expectedUserId = null,
}) {
  const { reference, amount, metadata, dedicatedAccount } =
    extractWalletSettlementContext(paystackData);

  if (!reference) {
    return {
      success: false,
      credited: false,
      status: 'failed',
      message: 'Missing Paystack reference',
    };
  }

  if (!amount || amount <= 0) {
    return {
      success: false,
      credited: false,
      status: 'failed',
      message: 'Invalid Paystack amount',
      reference,
    };
  }

const userId = await resolveUserIdForSettlement({
  metadata,
  dedicatedAccount,
  authorization: paystackData?.authorization,
  paystackData,
});

  if (!userId) {
    logger.error(
      {
        source,
        reference,
        accountNumber:
          dedicatedAccount?.account_number ||
          paystackData?.authorization?.receiver_bank_account_number ||
          null,
      },
      'Unable to resolve wallet owner for Paystack settlement'
    );

    await markFundingFailed({
      reference,
      providerReference: reference,
      rawPayload: {
        source,
        paystackData,
        reason: 'Unable to resolve wallet owner',
      },
      reason: 'Unable to resolve wallet owner',
    });

    return {
      success: false,
      credited: false,
      status: 'failed',
      message: 'Unable to resolve wallet owner',
      reference,
    };
  }

  if (expectedUserId && String(expectedUserId) !== String(userId)) {
    logger.warn(
      {
        source,
        reference,
        expectedUserId,
        resolvedUserId: userId,
      },
      'Paystack verify user mismatch'
    );

    await markFundingFailed({
      reference,
      providerReference: reference,
      rawPayload: {
        source,
        paystackData,
        reason: 'Payment does not belong to this user',
      },
      reason: 'Payment does not belong to this user',
    });

    return {
      success: false,
      credited: false,
      status: 'failed',
      message: 'Payment does not belong to this user',
      reference,
    };
  }

  const walletReference = resolveReferencePrefix(reference);

  // Ensure a funding row always exists before settlement.
  await upsertPendingFunding({
    userId,
    reference,
    amount,
    provider: 'paystack',
    providerReference: reference,
    walletReference,
    source,
    rawPayload: {
      source,
      paystackData,
    },
  });

  const existingFunding = await getFundingByReference(reference);

  if (
    existingFunding &&
    existingFunding.status === 'success' &&
    (
      existingFunding.processed === true ||
      existingFunding.wallet_reference === walletReference
    )
  ) {
    return {
      success: true,
      credited: false,
      status: 'success',
      amount,
      reference,
      userId,
      walletReference,
      message: 'Payment already settled',
    };
  }

  try {
    await markFundingSuccess({
      reference,
      providerReference: reference,
      walletReference,
      rawPayload: {
        source,
        paystackData,
      },
    });

    logger.info(
      {
        type: 'PAYSTACK_SETTLEMENT_SUCCESS',
        source,
        userId,
        amount,
        reference,
        walletReference,
      },
      'Paystack payment settled successfully'
    );

    return {
      success: true,
      credited: true,
      status: 'success',
      amount,
      reference,
      userId,
      walletReference,
      message: 'Wallet credited successfully',
    };
  } catch (err) {
    logger.error(
      {
        source,
        reference,
        walletReference,
        error: err.message,
        stack: err.stack,
      },
      'Paystack settlement failed'
    );

    await markFundingFailed({
      reference,
      providerReference: reference,
      rawPayload: {
        source,
        paystackData,
        error: err.message,
      },
      reason: err.message || 'Wallet settlement failed',
    });

    return {
      success: false,
      credited: false,
      status: 'failed',
      reference,
      message: err.message || 'Wallet settlement failed',
    };
  }
}

/**
 * 1) INITIALIZE QUICKPAY / CARD PAYMENT
 */
router.post('/init', authMiddleware, async (req, res) => {
  try {
    const authUser = req.user || {};
    const {
      amount,
      email,
      phone,
      reference,
      callback_url,
      paymentMethod,
    } = req.body || {};

    const userId = authUser.id || authUser.user_id || null;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Authenticated user not found',
      });
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount',
      });
    }

    if (numericAmount > MAX_CARD_FUNDING) {
      return res.status(400).json({
        success: false,
        code: 'CARD_FUNDING_LIMIT',
        message: `Card funding is limited to ₦${MAX_CARD_FUNDING.toLocaleString()}`,
      });
    }

    await assertCardFundingWithinLimit(userId, numericAmount);

    const customerEmail =
      email ||
      authUser.email ||
      buildFallbackEmail(userId);

    const safeReference =
      reference ||
      `PX-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const callbackUrl =
      callback_url ||
      `${APP_BASE_URL}/wallet/funding-success?ref=${encodeURIComponent(safeReference)}`;

    const walletReference = resolveReferencePrefix(safeReference);

    await upsertPendingFunding({
      userId,
      reference: safeReference,
      amount: numericAmount,
      provider: 'paystack',
      providerReference: null,
      walletReference,
      source: 'init',
      rawPayload: {
        source: 'init',
        callbackUrl,
        paymentMethod: paymentMethod || 'card',
      },
    });

    const payload = {
      amount: Math.round(numericAmount * 100),
      email: customerEmail,
      reference: safeReference,
      callback_url: callbackUrl,
      channels:
        paymentMethod === 'ussd'
          ? ['ussd']
          : paymentMethod === 'bank-transfer'
            ? ['bank_transfer']
            : paymentMethod === 'bank'
              ? ['bank']
              : paymentMethod === 'card'
                ? ['card']
                : undefined,
      metadata: {
        user_id: userId,
        phone: phone || authUser.phone || null,
        source: 'proxing-quickpay',
      },
    };

    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = response?.data?.data || {};

    return res.json({
      success: true,
      authorization_url: data.authorization_url,
      access_code: data.access_code,
      reference: data.reference,
      message: 'Payment initialized successfully',
    });
  } catch (error) {
    logger.error(
      {
        error: error?.response?.data || error?.message || error,
        stack: error?.stack,
      },
      'Paystack initialization error'
    );

    return res.status(500).json({
      success: false,
      message:
        error?.response?.data?.message ||
        error?.message ||
        'Paystack initialization failed',
    });
  }
});

/**
 * 2) VERIFY PAYMENT
 * Verifies with Paystack and settles wallet if webhook has not yet credited it.
 */
router.get('/verify/:reference', authMiddleware, async (req, res) => {
  try {
    const authUser = req.user || {};
    const expectedUserId = authUser.id || authUser.user_id || null;
    const reference = req.params.reference;

    if (!reference) {
      return res.status(400).json({
        success: false,
        status: 'failed',
        message: 'Reference is required',
      });
    }

    const response = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const paystackData = response?.data?.data;

    if (!paystackData) {
      return res.status(404).json({
        success: false,
        status: 'failed',
        message: 'Payment not found on Paystack',
      });
    }

    if (paystackData.status !== 'success') {
      return res.json({
        success: false,
        credited: false,
        status: paystackData.status || 'pending',
        amount: normalizeAmountFromPaystackKobo(paystackData.amount),
        reference: paystackData.reference || reference,
        message: `Payment status is ${paystackData.status || 'pending'}`,
      });
    }

    const settlement = await settlePaystackPayment({
      paystackData,
      source: 'verify',
      expectedUserId,
    });

    return res.json({
      success: settlement.success,
      credited: settlement.credited,
      status: settlement.status || 'success',
      amount: settlement.amount,
      reference: settlement.reference || reference,
      walletReference: settlement.walletReference,
      message: settlement.message,
    });
  } catch (error) {
    logger.error(
      {
        error: error?.response?.data || error?.message || error,
        stack: error?.stack,
        reference: req.params.reference,
      },
      'PAYSTACK VERIFY ERROR'
    );

    return res.status(500).json({
      success: false,
      credited: false,
      status: 'failed',
      message:
        error?.response?.data?.message ||
        error?.message ||
        'Failed to verify payment',
    });
  }
});

/**
 * 3) WEBHOOK
 * Must be mounted with express.raw({ type: 'application/json' })
 */
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];

    if (!signature) {
      logger.warn('Missing Paystack signature header');
      return res.sendStatus(200);
    }

    const expectedHash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(req.body)
      .digest('hex');

    if (signature !== expectedHash) {
      logger.warn('Invalid Paystack signature');
      return res.sendStatus(200);
    }

const event = JSON.parse(req.body.toString());

/**
 * 1) Standard Paystack checkout/card/bank payment
 */
if (event.event === 'charge.success') {
  if (!event.data || event.data.status !== 'success') {
    return res.sendStatus(200);
  }

  const settlement = await settlePaystackPayment({
    paystackData: event.data,
    source: 'webhook',
    expectedUserId: null,
  });

  if (!settlement.success) {
    logger.error(
      {
        type: 'PAYSTACK_WEBHOOK_SETTLEMENT_FAILED',
        reference: settlement.reference,
        message: settlement.message,
      },
      'Webhook settlement failed'
    );
  }

  return res.sendStatus(200);
}

/**
 * 2) Paystack Dedicated Virtual Account / transfer funding
 */
if (event.event === 'transfer.success') {
  const data = event.data || {};

  logger.info(
    {
      type: 'PAYSTACK_TRANSFER_SUCCESS_RECEIVED',
      reference: data.reference || null,
      amount: data.amount || null,
      recipient: data.recipient || null,
      rawEvent: event.event,
    },
    'Paystack transfer.success received'
  );

  const settlement = await settlePaystackPayment({
    paystackData: data,
    source: 'webhook',
    expectedUserId: null,
  });

  if (!settlement.success) {
    logger.error(
      {
        type: 'PAYSTACK_TRANSFER_SETTLEMENT_FAILED',
        reference: settlement.reference,
        message: settlement.message,
      },
      'Paystack transfer settlement failed'
    );
  }

  return res.sendStatus(200);
}

return res.sendStatus(200);

    return res.sendStatus(200);
  } catch (err) {
    logger.error(
      {
        error: err.message,
        stack: err.stack,
      },
      'PAYSTACK WEBHOOK ERROR'
    );

    return res.sendStatus(200);
  }
});

module.exports = router;
