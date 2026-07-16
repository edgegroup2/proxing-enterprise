'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const BASE = 'https://api.paystack.co';

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function paystackHeaders() {
  return {
    Authorization: `Bearer ${must('PAYSTACK_SECRET_KEY')}`,
    'Content-Type': 'application/json',
  };
}

async function createTransferRecipient({ name, account_number, bank_code }) {
  const res = await axios.post(
    `${BASE}/transferrecipient`,
    {
      type: 'nuban',
      name,
      account_number,
      bank_code,
      currency: 'NGN',
    },
    { headers: paystackHeaders(), timeout: 30000 }
  );
  return res.data;
}

async function initiateTransfer({ amount, recipient, reason, reference }) {
  const res = await axios.post(
    `${BASE}/transfer`,
    {
      source: 'balance',
      amount: Number(amount) * 100, // kobo
      recipient,
      reason,
      reference,
    },
    { headers: paystackHeaders(), timeout: 30000 }
  );
  logger.info({ type: 'PAYSTACK_TRANSFER_INIT', reference }, 'Paystack transfer initiated');
  return res.data;
}

module.exports = {
  createTransferRecipient,
  initiateTransfer,
};
