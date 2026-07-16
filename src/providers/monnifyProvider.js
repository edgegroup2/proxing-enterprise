'use strict';

const axios = require('axios');

const MONNIFY_BASE_URL =
  process.env.MONNIFY_BASE_URL || 'https://api.monnify.com';

const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY;
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const MONNIFY_CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE;

/**
 * Get Monnify access token
 */
async function getToken() {
  const auth = Buffer.from(
    `${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`
  ).toString('base64');

  const res = await axios.post(
    `${MONNIFY_BASE_URL}/api/v1/auth/login`,
    {},
    {
      headers: {
        Authorization: `Basic ${auth}`,
      },
      timeout: 15000,
    }
  );

  return res.data.responseBody.accessToken;
}

/**
 * Create reserved virtual account
 */
async function createReservedAccount(payload = {}) {
  const token = await getToken();

  const accountReference =
    payload.accountReference || `proxing_${Date.now()}`;

  const body = {
    accountReference,
    accountName: payload.name || 'PROXING USER',
    currencyCode: 'NGN',
    contractCode: MONNIFY_CONTRACT_CODE,
    customerEmail: payload.email || 'wallet@proxing.online',
    customerName: payload.name || 'Proxing User',
    bvn: payload.bvn || null,
    nin: payload.nin || null,
    getAllAvailableBanks: true,
  };

  const res = await axios.post(
    `${MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts`,
    body,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );

  return res.data;
}

module.exports = {
  createReservedAccount,
};
