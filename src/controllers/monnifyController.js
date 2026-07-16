'use strict';

const monnifyService = require('../services/monnifyService');

async function generateAccount(req, res) {
  try {
    const result = await monnifyService.generateReservedAccount(req.body || {});
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Monnify account generation failed',
    });
  }
}

async function verify(req, res) {
  try {
    const transactionReference =
      req.params.reference || req.query.reference || req.body?.reference;

    const result =
      await monnifyService.verifyMonnifyTransaction(transactionReference);

    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Monnify verification failed',
    });
  }
}

module.exports = {
  generateAccount,
  verify,
};
