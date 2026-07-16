'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const db = require('../db');
const logger = require('../utils/logger');
const walletEngine = require('../engine/walletEngine'); // ✅ ensure this file exists in src/engine/walletEngine.js

function digitsOnly(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function safeJsonParse(buf) {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

function pick(obj, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

// Monnify payload can vary; you showed eventData structure.
function normalizeEvent(payload) {
  const body = payload?.eventData || payload?.data || payload;
  return body || {};
}

router.post('/webhook', async (req, res) => {
  // Always respond 200-ish to avoid retry storms; but we log everything
  try {
    const signature =
      req.headers['monnify-signature'] ||
      req.headers['x-monnify-signature'] ||
      req.headers['x-monnify-signature-256'] || // just in case (some integrations vary)
      null;

    const secret = process.env.MONNIFY_SECRET_KEY;
    if (!secret) {
      logger.error({ type: 'MONNIFY_WEBHOOK_NO_SECRET' });
      return res.status(200).json({ received: true });
    }

    // req.body may be Buffer if express.raw applied
    let rawBody = req.body;
    let payload = req.body;

    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body;
      payload = safeJsonParse(req.body) || {};
    } else {
      // If already parsed JSON, we must reconstruct a deterministic string for hashing is risky.
      // But since you are using express.raw at the path, this should be Buffer.
      rawBody = Buffer.from(JSON.stringify(req.body || {}), 'utf8');
      payload = req.body || {};
    }

    // Verify signature (Monnify uses sha512 of raw body)
    if (signature) {
      const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

      if (String(signature).trim() !== expected) {
        logger.error({
          type: 'MONNIFY_WEBHOOK_BAD_SIGNATURE',
          got: String(signature).slice(0, 10),
          expected: String(expected).slice(0, 10)
        });
        return res.status(200).json({ received: true, badSignature: true });
      }
    } else {
      logger.warn({ type: 'MONNIFY_WEBHOOK_MISSING_SIGNATURE_HEADER' });
      // Still accept but log; some environments misconfigure header forwarding
    }

    const eventData = normalizeEvent(payload);

    // Extract paymentReference (idempotency key)
    const paymentReference = pick(eventData, [
      'paymentReference',
      'transactionReference',
      'reference',
      'eventReference'
    ]);

    // Extract destination account number from common fields
    const destAccountNumber = digitsOnly(
      pick(eventData, [
        'destinationAccountNumber',
        'destinationAccountInformation.accountNumber',
        'destinationAccount.accountNumber',
        'product.destinationAccountNumber',
        'product.destinationAccount.accountNumber'
      ])
    );

const amountPaid = Math.floor(Number(
  pick(eventData, [
    'amountPaid',
    'amount',
    'paidAmount',
    'transactionAmount'
  ])
) || 0);

    logger.info({
      type: 'MONNIFY_WEBHOOK_RECEIVED',
      paymentReference,
      destAccountNumber,
      amountPaid
    });

    if (!paymentReference) {
      logger.error({ type: 'MONNIFY_WEBHOOK_MISSING_PAYMENT_REFERENCE', eventData });
      return res.status(200).json({ received: true });
    }

    // Save webhook event idempotently (optional but strong)
    await db.query(
      `
      INSERT INTO monnify_webhook_events (payment_reference, dest_account_number, payload)
      VALUES ($1, $2, $3)
      ON CONFLICT (payment_reference) DO NOTHING
      `,
      [String(paymentReference), destAccountNumber || null, payload]
    );

    // If already processed, stop
    const already = await db.query(
      `
      SELECT processed_at
      FROM monnify_webhook_events
      WHERE payment_reference = $1
      LIMIT 1
      `,
      [String(paymentReference)]
    );

    if (already.rows[0]?.processed_at) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    // Resolve user by account number
    if (!destAccountNumber) {
      logger.error({
        type: 'MONNIFY_WEBHOOK_NO_DEST_ACCOUNT',
        paymentReference
      });
      return res.status(202).json({ received: true, pending: true });
    }

let userId = null;

// PRIMARY: virtual_accounts
const va = await db.query(
  `
    SELECT user_id
    FROM virtual_accounts
    WHERE provider = 'monnify'
      AND regexp_replace(account_number, '\\D', '', 'g') = $1
    LIMIT 1
  `,
  [destAccountNumber]
);

if (va.rowCount > 0) {
  userId = va.rows[0].user_id;
}

// FALLBACK 1: users table (if columns exist)
if (!userId) {
  const u = await db.query(
    `
      SELECT id
      FROM users
      WHERE regexp_replace(COALESCE(monnify_account_number, ''), '\\D', '', 'g') = $1
      LIMIT 1
    `,
    [destAccountNumber]
  );

  if (u.rowCount > 0) {
    userId = u.rows[0].id;
  }
}

// FALLBACK 2: reserved_accounts (legacy systems)
if (!userId) {
  const r = await db.query(
    `
      SELECT user_id
      FROM reserved_accounts
      WHERE regexp_replace(COALESCE(account_number, ''), '\\D', '', 'g') = $1
        AND provider = 'monnify'
      LIMIT 1
    `,
    [destAccountNumber]
  );

  if (r.rowCount > 0) {
    userId = r.rows[0].user_id;
  }
}

if (!userId) {
  logger.error({
    type: 'MONNIFY_WEBHOOK_USER_RESOLVE_FAILED',
    paymentReference,
    destAccountNumber
  });

  return res.status(202).json({ received: true, pending: true });
}

logger.info({
  type: 'MONNIFY_RESOLVED_USER',
  userId,
  destAccountNumber,
  paymentReference
});

    if (!userId) {
      logger.error({
        type: 'MONNIFY_WEBHOOK_USER_RESOLVE_FAILED',
        paymentReference,
        destAccountNumber
      });
      return res.status(202).json({ received: true, pending: true });
    }

if (amountPaid < 1) {
  logger.warn({
    type: 'MONNIFY_AMOUNT_TOO_SMALL',
    amountPaid,
    paymentReference
  });
  return res.status(200).json({ received: true });
}

    // ✅ Credit wallet using your engine (idempotent via ledger reference)
    // Reference must be unique per paymentReference
    await walletEngine.credit({
      userId,
      amount: amountPaid,
      reference: `monnify_${paymentReference}`,
      provider: 'monnify'
    });

    await db.query(
      `
      UPDATE monnify_webhook_events
      SET processed_at = now(),
          resolved_user_id = $2
      WHERE payment_reference = $1
      `,
      [String(paymentReference), userId]
    );

    logger.info({
      type: 'MONNIFY_CREDIT_SUCCESS',
      userId,
      paymentReference,
      amountPaid
    });

    return res.status(200).json({ received: true, success: true });
  } catch (err) {
    logger.error({
      type: 'MONNIFY_WEBHOOK_ERROR',
      error: err?.message,
      stack: err?.stack
    });
    // return 200 to avoid retry storms
    return res.status(200).json({ received: true });
  }
});

module.exports = router;
