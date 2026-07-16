// src/routes/withdrawal.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { evaluateWithdrawalRisk } = require('../engine/riskEngine');

router.post('/withdraw', async (req, res) => {
  const { userId, amount, bankCode, accountNumber, accountName } = req.body;

  // Basic validation
  if (!userId || !amount || !bankCode || !accountNumber) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const numericAmount = Number(amount);

  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  try {
    // ===============================
    // 1️⃣ RISK CHECK (BEFORE DB LOCK)
    // ===============================
    const risk = await evaluateWithdrawalRisk(userId, numericAmount);

    if (!risk.allowed) {
      return res.status(403).json({
        error: 'Withdrawal temporarily restricted due to risk assessment',
        riskScore: risk.score
      });
    }

    // ===============================
    // 2️⃣ BEGIN TRANSACTION
    // ===============================
    const client = await db.getClient();
    await client.query('BEGIN');

    try {

      // Lock wallet row (prevents race condition)
      const walletRes = await client.query(
        'SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE',
        [userId]
      );

      if (walletRes.rowCount === 0) {
        throw new Error('Wallet not found');
      }

      const balance = Number(walletRes.rows[0].balance);

      if (balance < numericAmount) {
        throw new Error('Insufficient balance');
      }

      const reference = `wd_${Date.now()}_${userId}`;

      // Atomic wallet debit via DB function
      await client.query(
        'SELECT wallet_debit($1,$2,$3)',
        [userId, numericAmount, reference]
      );

      // Insert withdrawal record
      await client.query(
        `
        INSERT INTO withdrawals 
        (user_id, amount, bank_code, account_number, account_name, reference, status, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,'pending', NOW())
        `,
        [userId, numericAmount, bankCode, accountNumber, accountName || null, reference]
      );

      await client.query('COMMIT');

      return res.json({
        success: true,
        reference,
        message: 'Withdrawal request accepted'
      });

    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: err.message });
    } finally {
      client.release();
    }

  } catch (err) {
    console.error('Withdrawal error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
