'use strict';

const axios = require('axios');

const VTPASS_BASE_URL =
  process.env.VTPASS_BASE_URL || 'https://vtpass.com/api';

function getHeaders() {
  const apiKey = process.env.VTPASS_API_KEY;
  const publicKey = process.env.VTPASS_PUBLIC_KEY;
  const secretKey = process.env.VTPASS_SECRET_KEY;

  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'api-key': apiKey } : {}),
    ...(publicKey ? { public_key: publicKey } : {}),
    ...(secretKey ? { secret_key: secretKey } : {}),
  };
}

async function getServiceVariations(serviceID) {
  const response = await axios.get(
    `${VTPASS_BASE_URL}/service-variations?serviceID=${encodeURIComponent(
      serviceID
    )}`,
    {
      headers: getHeaders(),
      timeout: 20000,
    }
  );

  return response.data;
}

async function verifyMerchant(payload) {
  const response = await axios.post(
    `${VTPASS_BASE_URL}/merchant-verify`,
    payload,
    {
      headers: getHeaders(),
      timeout: 20000,
    }
  );

  return response.data;
}

async function purchase(payload) {
  const response = await axios.post(`${VTPASS_BASE_URL}/pay`, payload, {
    headers: getHeaders(),
    timeout: 30000,
  });

  return response.data;
}

module.exports = {
  getServiceVariations,
  verifyMerchant,
  purchase,
};
