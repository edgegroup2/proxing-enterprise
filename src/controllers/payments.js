'use strict';

const walletService = require('../services/walletService');

/**
 * src/controllers/payments.js
 * Wallet/payment controller
 */

async function creditWalletAfterPayment(req, res) {
  try {
    const { userId, amount, reference, provider } = req.body || {};

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId',
      });
    }

    if (!reference) {
      return res.status(400).json({
        success: false,
        error: 'Missing reference',
      });
    }

    const numericAmount = Number(amount);

    if (!numericAmount || Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount',
      });
    }

    await walletService.creditWallet(
      userId,
      numericAmount,
      reference,
      provider || 'paystack'
    );

    return res.json({
      success: true,
      message: 'Wallet credited successfully',
      data: {
        userId,
        amount: numericAmount,
        reference,
        provider: provider || 'paystack',
      },
    });
  } catch (error) {
    console.error('creditWalletAfterPayment error:', error);

    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to credit wallet',
    });
  }
}

module.exports = {
  creditWalletAfterPayment,
};
