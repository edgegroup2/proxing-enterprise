'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');

const { evaluateWithdrawalRisk } = require('../engine/riskEngine');
const walletService = require('../services/walletService');
const monnifyDisbursement = require('../services/monnifyDisbursement');

function makeReference(userId) {
  return `wd-${Date.now()}-${userId}`;
}

router.post(['/withdraw', '/withdrawals'], async (req, res) => {
  const { userId, amount, bankCode, accountNumber, accountName } = req.body || {};

  if (!userId || !amount || !bankCode || !accountNumber) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const reference = makeReference(userId);
  const client = await db.getClient();

  let withdrawal = null;

  try {
    const risk = await evaluateWithdrawalRisk(userId, numericAmount);

    if (!risk?.allowed) {
      return res.status(403).json({
        error: 'Withdrawal blocked by risk engine',
        riskScore: risk?.score || null
      });
    }

    await client.query('BEGIN');

    const walletRes = await client.query(
      `
      SELECT id, available_balance
      FROM wallets
      WHERE user_id = $1
      FOR UPDATE
      `,
      [userId]
    );

    if (walletRes.rowCount === 0) {
      throw new Error('Wallet not found');
    }

    const wallet = walletRes.rows[0];

    if (wallet.available_balance === null || wallet.available_balance === undefined) {
      throw new Error('Wallet balance missing');
    }

    const available = Number(wallet.available_balance);

    if (!Number.isFinite(available)) {
      throw new Error('Invalid wallet balance');
    }

    if (available < numericAmount) {
      throw new Error('Insufficient balance');
    }

    await walletService.debitWallet(userId, {
      amount: numericAmount,
      reference,
      narration: 'Withdrawal',
      source: 'withdrawal'
    });

    const insertRes = await client.query(
      `
      INSERT INTO withdrawals
        (user_id, amount, bank_code, account_number, account_name, reference, status, created_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'processing', NOW())
      RETURNING *
      `,
      [userId, numericAmount, bankCode, accountNumber, accountName || null, reference]
    );

    withdrawal = insertRes.rows[0];

    await client.query('COMMIT');

    try {
      const result = await monnifyDisbursement.initiateSingleTransfer({
        amount: numericAmount,
        reference,
        narration: 'User withdrawal',
        destinationAccountNumber: accountNumber,
        destinationBankCode: bankCode,
        destinationAccountName: accountName
      });

      await db.query(
        `
        UPDATE withdrawals
        SET status = 'completed', updated_at = NOW()
        WHERE id = $1
        `,
        [withdrawal.id]
      );

      return res.json({
        success: true,
        reference,
        message: 'Withdrawal successful',
        provider: 'monnify',
        data: result
      });
    } catch (providerError) {
      console.error('MONNIFY ERROR:', providerError.message);

      await walletService.creditWallet(userId, {
        amount: numericAmount,
        reference: `${reference}-refund`,
        narration: 'Withdrawal refund',
        source: 'withdrawal-refund'
      });

      await db.query(
        `
        UPDATE withdrawals
        SET status = 'failed', updated_at = NOW()
        WHERE id = $1
        `,
        [withdrawal.id]
      );

      return res.status(500).json({
        error: 'Withdrawal failed and refunded',
        details: providerError.message
      });
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    console.error('Withdrawal error:', err);

    return res.status(500).json({
      error: err.message
    });
  } finally {
    client.release();
  }
});

module.exports = router;
