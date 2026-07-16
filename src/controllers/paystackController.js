'use strict';

const paystackService = require('../services/paystackService');

async function initialize(req, res) {
  try {
    const result = await paystackService.initializePayment(req.body || {});
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Paystack initialize failed',
    });
  }
}

async function verify(req, res) {
  try {
    const reference = req.params.reference || req.query.reference || req.body?.reference;
    const result = await paystackService.verifyPayment(reference);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Paystack verify failed',
    });
  }
}

async function createDedicatedAccount(req, res) {
  try {
    const result = await paystackService.generateDedicatedAccount(req.body || {});
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Dedicated account creation failed',
    });
  }
}

module.exports = {
  initialize,
  verify,
  createDedicatedAccount,
};
