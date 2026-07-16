'use strict';

/**
 * MONNIFY DISBURSEMENT (Single Transfer)
 * -------------------------------------
 * - Logs in with API key + Secret key (Basic auth)
 * - Caches accessToken in-memory
 * - Initiates single transfer from Monnify wallet to bank account
 *
 * IMPORTANT:
 * - Monnify requires your server IP to be whitelisted for Disbursement.
 * - `sourceAccountNumber` is REQUIRED and is typically your "Contract Code"
 *   or wallet source account number tied to your merchant/contract.
 *
 * ENV REQUIRED:
 *  - MONNIFY_API_KEY
 *  - MONNIFY_SECRET_KEY
 *  - MONNIFY_CONTRACT_CODE      (used as sourceAccountNumber)
 *
 * OPTIONAL ENV:
 *  - MONNIFY_DISBURSE_BASE_URL  (default: https://api.monnify.com/api/v2)
 *
 * VTPASS funding recipient ENV (required if using transferToVtpass helper):
 *  - VTPASS_FUND_ACCOUNT_NUMBER
 *  - VTPASS_FUND_ACCOUNT_NAME
 *  - VTPASS_FUND_BANK_CODE
 */

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const BASE_URL = String(process.env.MONNIFY_DISBURSE_BASE_URL || 'https://api.monnify.com/api/v2').trim().replace(/\/+$/, '');

function must(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === '') throw new Error(`Missing env: ${name}`);
  return String(v).trim();
}

function safeStr(v, d = '') {
  const s = String(v ?? '').trim();
  return s || d;
}

function makeReference(prefix = 'MNFY') {
  return `${prefix}${Date.now()}${crypto.randomBytes(6).toString('hex')}`;
}

// In-memory token cache
let cachedToken = null;
let cachedTokenExpMs = 0;

async function getAccessToken() {
  const now = Date.now();

  // Refresh 60 seconds before expiry
  if (cachedToken && now < cachedTokenExpMs - 60_000) return cachedToken;

  const apiKey = must('MONNIFY_API_KEY');
  const secretKey = must('MONNIFY_SECRET_KEY');

  const auth = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');

const LOGIN_URL = 'https://api.monnify.com/api/v1/auth/login';

const url = LOGIN_URL;

  try {
    const res = await axios.post(
      url,
      {},
      {
        headers: { Authorization: `Basic ${auth}` },
        timeout: 20_000,
      }
    );

    // Typical: res.data.responseBody.accessToken, expiresIn
    const token = res?.data?.responseBody?.accessToken;
    const expiresInSec = Number(res?.data?.responseBody?.expiresIn ?? 3600);

    if (!token) {
      logger.error({ type: 'MONNIFY_LOGIN_NO_TOKEN', data: res?.data });
      throw new Error('Monnify login failed: no accessToken in response');
    }

    cachedToken = token;
    cachedTokenExpMs = now + expiresInSec * 1000;

    logger.info({ type: 'MONNIFY_LOGIN_OK', expiresInSec });

    return token;
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;

    logger.error({
      type: 'MONNIFY_LOGIN_ERROR',
      status,
      data,
      error: err?.message,
    });

    throw new Error(`Monnify login failed${status ? ` (HTTP ${status})` : ''}: ${data?.responseMessage || err?.message}`);
  }
}

/**
 * Initiate single transfer.
 * Docs mention /disbursements/single
 */
async function initiateSingleTransfer(payload) {
  const token = await getAccessToken();

  const url = `${BASE_URL}/disbursements/single`;

  try {
    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });

    return res.data;
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;

    logger.error({
      type: 'MONNIFY_DISBURSE_ERROR',
      status,
      data,
      payload: {
        // Avoid leaking full info; keep safe minimal fields
        amount: payload?.amount,
        reference: payload?.reference,
        destinationAccountNumber: payload?.destinationAccountNumber,
        destinationBankCode: payload?.destinationBankCode,
      },
      error: err?.message,
    });

    // Very common when IP not whitelisted:
    // data.responseMessage/data.responseBody may mention IP.
    throw new Error(
      `Monnify disbursement failed${status ? ` (HTTP ${status})` : ''}: ${data?.responseMessage || err?.message}`
    );
  }
}

/**
 * Convenience: Transfer from Monnify wallet to VTpass funding NUBAN.
 * This is what your float manager calls.
 *
 * @param {number} amount
 * @param {string} reference optional
 * @param {string} narration optional
 */
async function transferToVtpass(amount, reference = null, narration = null) {
  const sourceAccountNumber = must('MONNIFY_SOURCE_ACCOUNT_NUMBER');

  const destAccountNumber = must('VTPASS_FUND_ACCOUNT_NUMBER');
  const destAccountName = must('VTPASS_FUND_ACCOUNT_NAME');
  const destBankCode = must('VTPASS_FUND_BANK_CODE');

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error('Invalid amount for transferToVtpass');
  }

  const ref = reference || makeReference('VTPASS_TOPUP_');
  const narr = narration || `Vtpass Float Topup ${ref}`;

  const body = {
    amount: amt,
    reference: ref,
    narration: narr,
    destinationAccountNumber: String(destAccountNumber),
    destinationAccountName: String(destAccountName),
    destinationBankCode: String(destBankCode),
    currency: 'NGN',
    sourceAccountNumber: String(sourceAccountNumber), // ✅ FIXED
  };

  logger.info({
    type: 'MONNIFY_DISBURSE_INIT',
    amount: amt,
    reference: ref,
    destinationAccountNumber: destAccountNumber,
    destinationBankCode: destBankCode,
  });

  const data = await initiateSingleTransfer(body);

  logger.info({
    type: 'MONNIFY_DISBURSE_DONE',
    reference: ref,
    responseCode: data?.responseCode,
    responseMessage: data?.responseMessage,
    requestSuccessful: data?.requestSuccessful,
  });

  return { reference: ref, data };
}

module.exports = {
  getAccessToken,
  initiateSingleTransfer,
  transferToVtpass,
  makeReference,
};
