const express = require("express");
const router = express.Router();
const db = require("../db");

/**
 * GET WALLET BY PHONE
 * /api/wallet/:phone
 */
router.get("/wallet/:phone", async (req, res) => {
  try {
    const phone = req.params.phone;

    const { rows } = await db.query(
      `
      SELECT 
        w.balance,
        w.account_number,
        w.bank_name
      FROM wallets w
      JOIN users u ON u.id = w.user_id
      WHERE u.phone = $1
      `,
      [phone]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Wallet error:", err);
    res.status(500).json({ error: "Failed to fetch wallet" });
  }
});

/**
 * GET TRANSACTIONS BY PHONE
 * /api/transactions/:phone
 */
router.get("/transactions/:phone", async (req, res) => {
  try {
    const phone = req.params.phone;

    const { rows } = await db.query(
      `
      SELECT 
        t.id,
        t.service,
        t.amount,
        t.status,
        t.reference,
        t.created_at
      FROM transactions t
      JOIN users u ON u.id = t.user_id
      WHERE u.phone = $1
      ORDER BY t.created_at DESC
      LIMIT 50
      `,
      [phone]
    );

    res.json(rows);
  } catch (err) {
    console.error("Transactions error:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

module.exports = router;
