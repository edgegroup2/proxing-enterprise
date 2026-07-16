'use strict';

const axios = require('axios');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function getHeaders() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    throw new Error('PAYSTACK_SECRET_KEY is missing');
  }

  return {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  };
}

async function initializeTransaction(payload) {
  const url = `${PAYSTACK_BASE_URL}/transaction/initialize`;

  const response = await axios.post(url, payload, {
    headers: getHeaders(),
    timeout: 20000,
  });

  return response.data;
}

async function verifyTransaction(reference) {
  const url = `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`;

  const response = await axios.get(url, {
    headers: getHeaders(),
    timeout: 20000,
  });

  return response.data;
}

async function createDedicatedAccount(payload) {
  const url = `${PAYSTACK_BASE_URL}/dedicated_account`;

  const response = await axios.post(url, payload, {
    headers: getHeaders(),
    timeout: 20000,
  });

  return response.data;
}

module.exports = {
  initializeTransaction,
  verifyTransaction,
  createDedicatedAccount,
};
