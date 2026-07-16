const express = require('express');
const router = express.Router();
const db = require('../db');
const { creditWallet } = require('../services/wallet.service');

router.post('/webhook', async (req, res) => {
  try {
    const { userId, amount, reference } = req.body;

    if (!userId || !amount || !reference) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const exists = await db.query(
      `SELECT id FROM ledger_entries WHERE reference = $1`,
      [`monnify_${reference}`]
    );

    if (exists.rows.length > 0) {
      return res.json({ alreadyProcessed: true });
    }

    await creditWallet(userId, amount, `monnify_${reference}`);

    await db.query(
      `INSERT INTO transactions (user_id, type, amount, reference, status)
       VALUES ($1, 'credit', $2, $3, 'success')`,
      [userId, amount, `monnify_${reference}`]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
