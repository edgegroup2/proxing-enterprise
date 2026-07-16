'use strict';

const express = require('express');
const axios = require('axios');

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

// Paystack API base
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

/**
 * Authoritative phone normalizer
 * 0814xxxxxxx     -> +234814xxxxxxx
 * 234814xxxxxxx   -> +234814xxxxxxx
 * +234814xxxxxxx  -> +234814xxxxxxx
 */
function normalizePhone(input) {
  if (!input) return null;

  const p = String(input).trim().replace(/[^\d+]/g, '');

  // 0814xxxxxxx -> +234814xxxxxxx
  if (/^0\d{10}$/.test(p)) return `+234${p.slice(1)}`;

  // 234814xxxxxxx -> +234814xxxxxxx
  if (/^234\d{10}$/.test(p)) return `+${p}`;

  // +234814xxxxxxx -> valid
  if (/^\+234\d{10}$/.test(p)) return p;

  return null;
}

/**
 * Paystack requires an email. If user has none, create one from phone digits.
 * Example: 08147863033 -> 08147863033@proxing.online
 */
function fallbackEmailFromPhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  return `${digits}@proxing.online`;
}

/**
 * Paystack request helper (consistent axios shape)
 */
async function paystackRequest({ method, url, data }) {
  return axios({
    method,
    url,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    data,
  });
}

/**
 * Create Paystack customer (strict)
 * Returns { customerCode, raw }
 */
async function ensurePaystackCustomerCode({ email, firstName, lastName, phone }) {
  const phonePaystack = String(phone).replace(/^\+/, '');

  const customerPayload = {
    email: String(email),
    first_name: String(firstName),
    last_name: String(lastName),
    phone: String(phonePaystack),
  };

  logger.info(
    { type: 'PAYSTACK_CUSTOMER_CREATE_STRICT', payload: customerPayload },
    'Creating STRICT Paystack customer'
  );

  const customerRes = await paystackRequest({
    method: 'post',
    url: `${PAYSTACK_BASE_URL}/customer`,
    data: customerPayload,
  });

  const code = customerRes?.data?.data?.customer_code;
  if (!code) throw new Error('Customer creation failed - no customer_code returned');

  return { customerCode: code, raw: customerRes.data };
}

/**
 * Paystack dedicated account response parsing (handles multiple shapes)
 * Returns { accountNumber, bankName, rawData }
 */
function parseDedicatedAccountResponse(paystackResData) {
  // Often: { status:true, message:'', data:{...} }
  const data = paystackResData?.data ?? paystackResData;

  const accountNumber =
    data?.account_number ||
    data?.accountNumber ||
    data?.account?.account_number ||
    data?.account?.number ||
    data?.bank?.account_number ||
    data?.bank?.accountNumber ||
    null;

  const bankName =
    data?.bank?.name ||
    data?.bank_name ||
    data?.bankName ||
    data?.account?.bank?.name ||
    data?.account?.bank_name ||
    null;

  return {
    accountNumber: accountNumber ? String(accountNumber) : null,
    bankName: bankName ? String(bankName) : null,
    rawData: data,
  };
}

/**
 * POST /api/paystack-va/generate
 */
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const authed = req.user;
    if (!authed || !authed.id) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Always read freshest user row from DB
    const userRes = await db.query(
      `SELECT id, email, phone, paystack_customer_code
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [authed.id]
    );

    if (userRes.rowCount === 0) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const user = userRes.rows[0];

    // Names (allow body override)
    const firstName =
      req.body?.first_name ||
      req.body?.firstName ||
      authed.first_name ||
      'User';

    const lastName =
      req.body?.last_name ||
      req.body?.lastName ||
      authed.last_name ||
      'Proxing';

    // Phone: DB first, else request body
    const rawPhone =
      user.phone ||
      req.body?.phone ||
      req.body?.phoneNumber ||
      req.body?.mobile ||
      null;

    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Phone is required (expected 0814xxxxxxx or 2348xxxxxxxxxx or +2348xxxxxxxxxx).',
      });
    }

    // Email: DB first, else request, else fallback
    const email = user.email || req.body?.email || fallbackEmailFromPhone(rawPhone);
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required (or provide phone to auto-generate one).',
      });
    }

    /**
     * FIX #1: Idempotency check must require BOTH bank_name and account_number.
     * Also: return BOTH camelCase + snake_case to satisfy any frontend.
     */
    const existing = await db.query(
      `
      SELECT bank_name, account_number
      FROM virtual_accounts
      WHERE user_id = $1 AND provider = 'paystack'
      LIMIT 1
      `,
      [user.id]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const hasAcc = row.account_number && String(row.account_number).trim() !== '';
      const hasBank = row.bank_name && String(row.bank_name).trim() !== '';

      if (hasAcc && hasBank) {
        return res.json({
          success: true,
          provider: 'paystack',
          reused: true,

          // camelCase
          bankName: row.bank_name,
          accountNumber: row.account_number,

          // snake_case
          bank_name: row.bank_name,
          account_number: row.account_number,
        });
      }

      // Existing row is partial/empty — continue to generate fresh one
      logger.warn(
        {
          type: 'PAYSTACK_VA_EXISTING_PARTIAL',
          userId: user.id,
          bank_name: row.bank_name || null,
          account_number: row.account_number || null,
        },
        'Existing Paystack VA row is partial; regenerating'
      );
    }

    logger.info(
      { type: 'PAYSTACK_VA_GENERATE_START', userId: user.id, email, phone },
      'Generating Paystack VA'
    );

    /**
     * Ensure Paystack customer exists
     */
    let customerCode = user.paystack_customer_code;

    if (!customerCode) {
      const ensured = await ensurePaystackCustomerCode({
        email,
        firstName,
        lastName,
        phone,
      });

      customerCode = ensured.customerCode;

      // Save customer_code to users table
      await db.query(
        `UPDATE users
         SET paystack_customer_code = $1
         WHERE id = $2`,
        [customerCode, user.id]
      );
    }

    /**
     * Optional: update customer (keeps Paystack aligned)
     */
    const phonePaystack = String(phone).replace(/^\+/, '');
    await paystackRequest({
      method: 'put',
      url: `${PAYSTACK_BASE_URL}/customer/${customerCode}`,
      data: {
        phone: phonePaystack,
        first_name: String(firstName),
        last_name: String(lastName),
        email: String(email),
      },
    });

    /**
     * Create dedicated account
     */
    const dedicatedPayload = {
      customer: customerCode,
      preferred_bank: 'titan-paystack',
    };

    logger.info(
      { type: 'PAYSTACK_DVA_PAYLOAD', payload: dedicatedPayload },
      'Creating dedicated account on Paystack'
    );

    const dedicatedRes = await paystackRequest({
      method: 'post',
      url: `${PAYSTACK_BASE_URL}/dedicated_account`,
      data: dedicatedPayload,
    });

    // Robust parse
    const parsed = parseDedicatedAccountResponse(dedicatedRes?.data);

    logger.info(
      {
        type: 'PAYSTACK_DVA_RESPONSE_PARSED',
        userId: user.id,
        accountNumber: parsed.accountNumber,
        bankName: parsed.bankName,
      },
      'Parsed Paystack dedicated account response'
    );

    if (!parsed.accountNumber) {
      logger.error(
        {
          type: 'PAYSTACK_DVA_PARSE_FAILED',
          userId: user.id,
          debug: dedicatedRes?.data,
        },
        'Paystack did not return account_number in a known shape'
      );

      return res.status(500).json({
        success: false,
        error: 'Paystack did not return account_number',
        debug: dedicatedRes?.data,
      });
    }

    const finalBankName = parsed.bankName || 'Paystack-Titan';
    const finalAccountNumber = String(parsed.accountNumber);

    /**
     * FIX #2: UPSERT to DB always runs (table is: virtual_accounts)
     */
    await db.query(
      `
      INSERT INTO virtual_accounts (user_id, provider, bank_name, account_number)
      VALUES ($1, 'paystack', $2, $3)
      ON CONFLICT (user_id, provider)
      DO UPDATE SET
        bank_name = EXCLUDED.bank_name,
        account_number = EXCLUDED.account_number
      `,
      [user.id, finalBankName, finalAccountNumber]
    );

await db.query(
  `
    UPDATE users
    SET paystack_va_account_number = $1,
        paystack_bank_name = $2
    WHERE id = $3
  `,
  [finalAccountNumber, finalBankName, user.id]
);

    logger.info(
      {
        type: 'PAYSTACK_VA_SAVED',
        userId: user.id,
        bankName: finalBankName,
        accountNumber: finalAccountNumber,
      },
      'Paystack VA saved'
    );

    /**
     * FIX #3: Return BOTH camelCase + snake_case so UI can display regardless
     */
    return res.json({
      success: true,
      provider: 'paystack',
      reused: false,

      // camelCase
      bankName: finalBankName,
      accountNumber: finalAccountNumber,

      // snake_case
      bank_name: finalBankName,
      account_number: finalAccountNumber,
    });
  } catch (err) {
    logger.error(
      {
        type: 'PAYSTACK_VA_GENERATE_ERROR',
        error: err?.message,
        stack: err?.stack,
        paystack: err?.response?.data,
      },
      'Paystack VA generation failed'
    );

    return res.status(500).json({
      success: false,
      error: 'Failed to generate virtual account',
      details: err?.response?.data || err?.message,
    });
  }
});

module.exports = router;
