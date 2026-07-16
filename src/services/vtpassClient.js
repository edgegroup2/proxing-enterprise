'use strict';

const axios = require('axios');

const BASE_URL = (
  process.env.VTPASS_BASE_URL ||
  'https://vtpass.com/api'
).replace(/\/+$/, '');

function getCredentials() {
  return {
    apiKey: String(process.env.VTPASS_API_KEY || '').trim(),
    secretKey: String(process.env.VTPASS_SECRET_KEY || '').trim(),
    publicKey: String(process.env.VTPASS_PUBLIC_KEY || '').trim()
  };
}

function buildHeaders() {
  const { apiKey, secretKey, publicKey } = getCredentials();

  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'api-key': apiKey,
    'secret-key': secretKey,
    'public-key': publicKey
  };
}

function sanitizePayloadForLogs(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  const clone = { ...payload };

  if (clone.api_key) clone.api_key = '[redacted]';
  if (clone.apiKey) clone.apiKey = '[redacted]';
  if (clone.secret_key) clone.secret_key = '[redacted]';
  if (clone.secretKey) clone.secretKey = '[redacted]';
  if (clone.public_key) clone.public_key = '[redacted]';
  if (clone.publicKey) clone.publicKey = '[redacted]';

  return clone;
}

function normalizeError(err) {
  const status = err?.response?.status || 500;
  const payload = err?.response?.data || null;

  const message =
    payload?.response_description ||
    payload?.message ||
    payload?.error ||
    err?.message ||
    'VTpass request failed';

  const e = new Error(message);
  e.status = status;
  e.payload = payload;
  return e;
}

async function getRequest(path, params = {}) {
  try {
    const response = await axios.get(`${BASE_URL}${path}`, {
      params,
      headers: buildHeaders(),
      timeout: 30000
    });

    return response.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

async function postRequest(path, body = {}) {
  try {
    const response = await axios.post(`${BASE_URL}${path}`, body, {
      headers: buildHeaders(),
      timeout: 30000
    });

    return response.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Get VTpass wallet balance
 */
async function getWalletBalance() {
  return getRequest('/balance');
}

/**
 * Fetch service variations
 */
async function serviceVariations(serviceID) {
  if (!serviceID) {
    throw new Error('serviceID required');
  }

  return getRequest('/service-variations', {
    serviceID: String(serviceID).trim()
  });
}

/**
 * Verify electricity meter / TV IUC
 */
async function merchantVerify({ serviceID, billersCode, type }) {
  if (!serviceID) throw new Error('serviceID required');
  if (!billersCode) throw new Error('billersCode required');
  if (!type) throw new Error('type required');

  return postRequest('/merchant-verify', {
    serviceID: String(serviceID).trim(),
    billersCode: String(billersCode).trim(),
    type: String(type).trim()
  });
}

/**
 * Purchase product
 */
async function pay(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload is required');
  }

  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );

  return postRequest('/pay', cleanPayload);
}

module.exports = {
  getWalletBalance,
  serviceVariations,
  merchantVerify,
  pay,
  sanitizePayloadForLogs
};
