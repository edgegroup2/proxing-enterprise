'use strict';

const paystackProvider = require('../providers/paystackProvider');

async function initializePayment({
  email,
  amount,
  reference,
  callback_url,
  metadata,
}) {
  if (!email) throw new Error('email is required');
  if (!amount || Number(amount) <= 0) throw new Error('amount is required');

  const payload = {
    email,
    amount: Number(amount),
    reference,
    callback_url,
    metadata,
  };

  const result = await paystackProvider.initializeTransaction(payload);

  return {
    success: !!result?.status,
    message: result?.message || 'Paystack initialize completed',
    data: result?.data || null,
    raw: result,
  };
}

async function verifyPayment(reference) {
  if (!reference) throw new Error('reference is required');

  const result = await paystackProvider.verifyTransaction(reference);

  return {
    success: !!result?.status,
    message: result?.message || 'Paystack verify completed',
    data: result?.data || null,
    raw: result,
  };
}

async function generateDedicatedAccount({
  email,
  first_name,
  last_name,
  phone,
  preferred_bank,
}) {
  if (!email) throw new Error('email is required');
  if (!first_name) throw new Error('first_name is required');
  if (!last_name) throw new Error('last_name is required');

  const payload = {
    email,
    first_name,
    last_name,
    phone,
    preferred_bank,
  };

  const result = await paystackProvider.createDedicatedAccount(payload);

  return {
    success: !!result?.status,
    message: result?.message || 'Dedicated account created',
    data: result?.data || null,
    raw: result,
  };
}

module.exports = {
  initializePayment,
  verifyPayment,
  generateDedicatedAccount,
};
