'use strict';

const express = require('express');
const pool = require('./db');
const walletService = require('./services/walletService');

const router = express.Router();

router.post('/webhook', async (req, res) => {
  try {
    const eventData = req.body?.eventData || {};
    const amountPaid = Number(eventData.amountPaid || 0);
    const customerEmail = eventData.customerEmail;
    const transactionReference = eventData.transactionReference;

    if (!customerEmail || !transactionReference || !Number.isFinite(amountPaid) || amountPaid <= 0) {
      return res.sendStatus(200);
    }

    const userResult = await pool.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [customerEmail]
    );

    if (userResult.rowCount === 0) {
      return res.sendStatus(200);
    }

    const userId = userResult.rows[0].id;

    // Idempotent wallet credit via safe wallet engine wrapper
    await walletService.creditWallet(
      userId,
      amountPaid,
      transactionReference,
      'monnify'
    );

    return res.sendStatus(200);
  } catch (err) {
    console.error('monnify webhook error:', err);
    return res.sendStatus(200);
  }
});

module.exports = router;
