'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const BASE_URL = process.env.MONNIFY_BASE_URL || 'https://api.monnify.com';

let cachedAccessToken = null;
let cachedTokenExpiresAt = 0;

function safeStr(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function digitsOnly(v) {
  return safeStr(v).replace(/\D/g, '');
}

function getBasicAuthHeader() {
  const apiKey = safeStr(process.env.MONNIFY_API_KEY).trim();
  const secretKey = safeStr(process.env.MONNIFY_SECRET_KEY).trim();

  if (!apiKey || !secretKey) {
    throw new Error('Missing Monnify credentials | MONNIFY_API_KEY / MONNIFY_SECRET_KEY');
  }

  const token = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  return `Basic ${token}`;
}

async function getAccessToken() {
  const now = Date.now();

  // reuse cached token (refresh 60s before expiry)
  if (cachedAccessToken && now < cachedTokenExpiresAt - 60_000) return cachedAccessToken;

  // Safe auth debug (no secret leaks)
  logger.info({
    type: 'MONNIFY_AUTH_DEBUG',
    baseUrl: BASE_URL,
    hasApiKey: !!process.env.MONNIFY_API_KEY,
    hasSecretKey: !!process.env.MONNIFY_SECRET_KEY,
    contractCodeLen: safeStr(process.env.MONNIFY_CONTRACT_CODE).length,
  });

  const url = `${BASE_URL}/api/v1/auth/login`;
  const Authorization = getBasicAuthHeader();

  // Log auth header prefix only (NOT the value)
  logger.info({
    type: 'MONNIFY_AUTH_HEADER_TYPE',
    authorizationStartsWith: safeStr(Authorization).slice(0, 5), // expect "Basic"
  });

  const res = await axios.post(url, null, {
    headers: {
      Authorization,
      Accept: 'application/json',
    },
    timeout: 15000,
  });

  const body = res?.data;
  const accessToken = body?.responseBody?.accessToken;
  const expiresIn = Number(body?.responseBody?.expiresIn || 0);

  if (!accessToken) {
    throw new Error('Monnify login succeeded but no accessToken returned');
  }

  cachedAccessToken = accessToken;
  cachedTokenExpiresAt = Date.now() + (expiresIn > 0 ? expiresIn * 1000 : 55 * 60 * 1000);

  logger.info({
    type: 'MONNIFY_LOGIN_OK',
    expiresIn,
  });

  return accessToken;
}

/**
 * STRICT reserved account generator (SERVICE LAYER ONLY)
 * - Gets access token
 * - Calls Monnify reserved-accounts endpoint
 * - DOES NOT TOUCH DB (route owns persistence)
 *
 * Expected input:
 * { userId, email, name, bvn?, nin?, preferredBanks?, getAllAvailableBanks? }
 */
async function createReservedAccountStrict({
  userId,
  email,
  name,
  bvn = null,
  nin = null,
  preferredBanks = null,
  getAllAvailableBanks = null,
} = {}) {
  const contractCode = safeStr(process.env.MONNIFY_CONTRACT_CODE).trim();
  if (!contractCode) throw new Error('Missing MONNIFY_CONTRACT_CODE');

  if (!userId) throw new Error('Missing userId');

  const cleanedBVN = digitsOnly(bvn);
  const cleanedNIN = digitsOnly(nin);

  // Enforce BVN or NIN (because Monnify returns responseCode "99" without it)
  if (!cleanedBVN && !cleanedNIN) {
    throw new Error('BVN or NIN is required (service validation)');
  }

  // Decide banks rule:
  // If preferredBanks provided -> use it
  // Else default to getAllAvailableBanks = true (matches Monnify guidance)
  let banks = preferredBanks;
  if (Array.isArray(banks)) banks = banks.filter(Boolean).map(String);
  if (!banks || banks.length === 0) banks = null;

  const allowAllBanks =
    getAllAvailableBanks === true || (!banks && getAllAvailableBanks !== false);

  const accessToken = await getAccessToken();

  const url = `${BASE_URL}/api/v2/bank-transfer/reserved-accounts`;

  const payload = {
    accountReference: `user_${safeStr(userId)}`,
    accountName: safeStr(name) || `User ${safeStr(userId)}`,
    currencyCode: 'NGN',
    contractCode,
    customerEmail: safeStr(email) || `${digitsOnly(userId)}@proxng.online`,
    customerName: safeStr(name) || `User ${safeStr(userId)}`,

    // Identity (Monnify enforces at least one)
    ...(cleanedBVN ? { bvn: cleanedBVN } : {}),
    ...(cleanedNIN ? { nin: cleanedNIN } : {}),

    // Banks rule (Monnify enforces one of these)
    ...(banks ? { preferredBanks: banks } : {}),
    ...(allowAllBanks ? { getAllAvailableBanks: true } : {}),
  };

  // IMPORTANT: reserved-accounts uses Bearer access token
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  logger.info({
    type: 'MONNIFY_RESERVED_ACCOUNT_CALL',
    url,
    authPrefix: safeStr(headers.Authorization).slice(0, 6), // "Bearer"
    hasPreferredBanks: !!banks,
    preferredBanksCount: banks ? banks.length : 0,
    getAllAvailableBanks: !!payload.getAllAvailableBanks,
    hasBVN: !!cleanedBVN,
    hasNIN: !!cleanedNIN,
  });

  try {
    const res = await axios.post(url, payload, { headers, timeout: 20000 });

    logger.info({
      type: 'MONNIFY_RESERVED_ACCOUNT_OK',
      userId,
      responseCode: res?.data?.responseCode,
      requestSuccessful: res?.data?.requestSuccessful,
    });

    return res.data;
  } catch (err) {
    const details = err?.response?.data || err?.message || err;

    logger.error({
      type: 'MONNIFY_RESERVED_CREATE_FAILED',
      userId,
      details,
    });

    throw err;
  }
}

module.exports = {
  createReservedAccountStrict,
};
