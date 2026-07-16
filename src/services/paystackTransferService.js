'use strict';

const axios = require('axios');

const PAYSTACK_BASE = 'https://api.paystack.co';
const SECRET = process.env.PAYSTACK_SECRET_KEY;

/**
 * You MUST set these in ecosystem env:
 * VTPASS_TOPUP_BANK_CODE=50515 (example)
 * VTPASS_TOPUP_ACCOUNT_NUMBER=6567667943
 * VTPASS_TOPUP_ACCOUNT_NAME=Nurudeen Ajibola Alliyu
 * PAYSTACK_VTPASS_RECIPIENT_CODE= (optional cache)
 */
function paystackHeaders() {
  return {
    Authorization: `Bearer ${SECRET}`,
    'Content-Type': 'application/json',
  };
}

async function paystackRequest({ method, path, data }) {
  const url = `${PAYSTACK_BASE}${path}`;
  const res = await axios({
    method,
    url,
    data,
    timeout: 45000,
    headers: paystackHeaders(),
  });
  return res.data;
}

async function ensureRecipientCode() {
  if (!SECRET) throw new Error('PAYSTACK_SECRET_KEY missing');

  const cached = process.env.PAYSTACK_VTPASS_RECIPIENT_CODE;
  if (cached && String(cached).trim()) return String(cached).trim();

  const bank_code = process.env.VTPASS_TOPUP_BANK_CODE;
  const account_number = process.env.VTPASS_TOPUP_ACCOUNT_NUMBER;
  const name = process.env.VTPASS_TOPUP_ACCOUNT_NAME || 'VTPass Wallet';

  if (!bank_code || !account_number) {
    throw new Error('Missing VTPASS_TOPUP_BANK_CODE or VTPASS_TOPUP_ACCOUNT_NUMBER in env');
  }

  const data = await paystackRequest({
    method: 'post',
    path: '/transferrecipient',
    data: {
      type: 'nuban',
      name,
      account_number,
      bank_code,
      currency: 'NGN',
    },
  });

  const recipient = data?.data?.recipient_code;
  if (!recipient) throw new Error('Paystack recipient_code not returned');

  // IMPORTANT:
  // You cannot auto-write ecosystem env from code.
  // So you MUST copy this into ecosystem file after first run.
  return recipient;
}

async function initiateTransfer({ amountNaira, reason, reference }) {
  const recipient = await ensureRecipientCode();

  const kobo = Math.round(Number(amountNaira) * 100);

  const data = await paystackRequest({
    method: 'post',
    path: '/transfer',
    data: {
      source: 'balance',
      amount: kobo,
      recipient,
      reason: reason || 'VTPass float topup',
      reference: reference || `vtpass_topup_${Date.now()}`,
    },
  });

  return data;
}

module.exports = { ensureRecipientCode, initiateTransfer };

