'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const authModule = require('../middleware/auth');

const authMiddleware =
  typeof authModule === 'function'
    ? authModule
    : (authModule.requireAuth ||
       authModule.authMiddleware ||
       authModule.auth ||
       authModule.userAuth ||
       authModule.default);

if (typeof authMiddleware !== 'function') {
  throw new Error(
    `Auth middleware is not a function. Exported keys: ${Object.keys(authModule || {}).join(', ')}`
  );
}
const logger = require('../utils/logger');

const { createReservedAccountStrict } = require('../services/monnifyService');

// ------------------------- helpers -------------------------

function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '');
}

async function fetchSavedMonnifyVA(userId) {
  const r = await db.query(
    `
    SELECT bank_name, account_number, account_name
    FROM virtual_accounts
    WHERE user_id = $1 AND provider = 'monnify'
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [userId]
  );
  return r.rows[0] || null;
}

function isUniqueViolation(e) {
  return e && (e.code === '23505' || e.code === 23505);
}

// If you have a named constraint, keep this as a safe fallback check too
function isProviderAccountUniqueConflict(err) {
  if (!err) return false;
  if (isUniqueViolation(err)) return true;
  const msg = String(err.message || '');
  // add your real constraint name(s) here if you have them
  return (
    msg.includes('uniq_virtual_accounts_provider_account') ||
    msg.includes('virtual_accounts_provider_account') ||
    msg.includes('provider_account_number') ||
    msg.includes('unique')
  );
}

// Monnify success shape you confirmed in Postman:
// res.data.responseBody.accounts[0] = { bankName, bankCode, accountNumber, accountName }
function extractAccountFromMonnify(raw) {
  const body =
    raw?.responseBody ||
    raw?.data?.responseBody ||
    raw?.data ||
    raw;

  const acct = Array.isArray(body?.accounts) ? body.accounts[0] : null;

  const accountNumber = digitsOnly(acct?.accountNumber);
  const bankName = acct?.bankName || body?.bankName || 'Monnify';
  const accountName = acct?.accountName || body?.accountName || null;

  return { accountNumber, bankName, accountName, body };
}

// ------------------------- route -------------------------

// POST /api/monnify/generate-account
router.post('/generate-account', authMiddleware, async (req, res) => {
  const userId = req?.user?.id;

  logger.info({
    type: 'MONNIFY_GENERATE_ROUTE_HIT',
    path: req.originalUrl,
    userId,
  });

  try {
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // 1) Return existing saved VA (single source of truth)
    const existing = await fetchSavedMonnifyVA(userId);
    if (existing?.account_number) {
      return res.json({
        success: true,
        reused: true,
        provider: 'monnify',
        bankName: existing.bank_name,
        accountNumber: existing.account_number,
        accountName: existing.account_name || null,

        // snake_case convenience (if frontend expects it)
        bank_name: existing.bank_name,
        account_number: existing.account_number,
        account_name: existing.account_name || null,
      });
    }

    // 2) Load user details (email/name/phone)
    const userRes = await db.query(
      `SELECT id, email, name, phone FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    if (!userRes.rows.length) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const user = userRes.rows[0];

    // 3) BVN/NIN must be provided by frontend for LIVE (Monnify enforces it)
    const bvn = req?.body?.bvn ? digitsOnly(req.body.bvn) : null;
    const nin = req?.body?.nin ? digitsOnly(req.body.nin) : null;

    if (!bvn && !nin) {
      return res.status(400).json({
        success: false,
        error: 'BVN or NIN is required to generate Monnify account',
      });
    }

    // Optional: allow frontend to pass preferredBanks
    // Example: ["50515"] (Moniepoint MFB)
    const preferredBanks =
      Array.isArray(req?.body?.preferredBanks) && req.body.preferredBanks.length
        ? req.body.preferredBanks.map(String)
        : null;

    const MAX_TRIES = 3;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      logger.info({
        type: 'MONNIFY_CREATE_ATTEMPT',
        userId,
        attempt,
        hasBVN: !!bvn,
        hasNIN: !!nin,
        preferredBanksCount: preferredBanks ? preferredBanks.length : 0,
      });

      // 4) Call Monnify STRICT service (API only, no DB writes)
      const created = await createReservedAccountStrict({
        userId,
        email: user.email || `${digitsOnly(user.phone)}@proxng.online`,
        name: user.name || 'ProxNG Wallet',
        bvn,
        nin,

        // IMPORTANT: satisfy Monnify rule:
        // either preferredBanks OR getAllAvailableBanks: true
        preferredBanks,
        getAllAvailableBanks: preferredBanks ? false : true,
      });

      const raw = created?.raw ?? created;

      // 5) Extract from the exact shape you confirmed: responseBody.accounts[0]
      const { accountNumber, bankName, accountName, body } = extractAccountFromMonnify(raw);

      logger.info({
        type: 'MONNIFY_VA_EXTRACTED',
        userId,
        attempt,
        bankName,
        accountNumber,
        accountName,
      });

      if (!accountNumber) {
        logger.error({
          type: 'MONNIFY_VA_CREATE_NO_ACCOUNT_NUMBER',
          userId,
          attempt,
          // Keep raw out of response to client; log only
          debugKeys: Object.keys(body || {}),
        });

        // retry
        if (attempt < MAX_TRIES) continue;

        return res.status(502).json({
          success: false,
          error: 'Monnify did not return accountNumber',
        });
      }

      // 6) Save to DB (single source of truth)
      try {
        await db.query(
          `
          INSERT INTO virtual_accounts (user_id, provider, bank_name, account_number, account_name)
          VALUES ($1, 'monnify', $2, $3, $4)
          ON CONFLICT (user_id, provider)
          DO UPDATE SET
            bank_name = EXCLUDED.bank_name,
            account_number = EXCLUDED.account_number,
            account_name = EXCLUDED.account_name
          `,
          [userId, bankName, String(accountNumber), accountName]
        );

        // REQUIRED LOG (you asked for this EXACTLY)
        logger.info({
          type: 'MONNIFY_VA_DB_SAVED_CONFIRMED',
          userId,
          accountNumber,
        });
      } catch (e) {
        if (isProviderAccountUniqueConflict(e)) {
          logger.warn({
            type: 'MONNIFY_VA_DB_CONFLICT_RETRY',
            userId,
            attempt,
            error: e.message,
          });

          // retry
          if (attempt < MAX_TRIES) continue;

          return res.status(409).json({
            success: false,
            error: 'Monnify VA conflict, please retry',
          });
        }

        logger.error({
          type: 'MONNIFY_VA_DB_ERROR',
          userId,
          attempt,
          error: e.message,
          stack: e.stack,
        });

        return res.status(500).json({ success: false, error: 'DB save failed' });
      }

      // 7) Re-fetch from DB and return ONLY DB row (single source of truth)
      const saved = await fetchSavedMonnifyVA(userId);

      if (!saved?.account_number) {
        logger.error({
          type: 'MONNIFY_VA_DB_MISSING_AFTER_UPSERT',
          userId,
          attempt,
          attemptedAccountNumber: accountNumber,
        });

        return res.status(500).json({
          success: false,
          error: 'Failed to persist Monnify VA',
        });
      }

      return res.json({
        success: true,
        reused: false,
        provider: 'monnify',
        bankName: saved.bank_name,
        accountNumber: saved.account_number,
        accountName: saved.account_name || null,

        // snake_case convenience
        bank_name: saved.bank_name,
        account_number: saved.account_number,
        account_name: saved.account_name || null,
      });
    }

    // If loop exits unexpectedly
    return res.status(500).json({ success: false, error: 'Monnify generation failed' });
  } catch (err) {
    const details = err?.response?.data || err?.message || err;

    logger.error({
      type: 'MONNIFY_GENERATE_ERROR',
      userId,
      details,
      stack: err?.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to create Monnify account',
      details,
    });
  }
});

module.exports = router;
