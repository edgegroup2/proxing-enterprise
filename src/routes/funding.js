const express = require("express");
const router = express.Router();
const pool = require("../db");
const { v4: uuidv4 } = require("uuid");

// Health check
router.get("/ping", (req, res) => {
  res.json({ ok: true, router: "funding" });
});

// Initiate funding
router.post("/initiate", async (req, res) => {
  try {
    const { userId, amount } = req.body;

    // 1. Hard validation
    if (!userId || !amount) {
      return res.status(400).json({
        error: "userId and amount are required"
      });
    }

    // 2. UUID format validation
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(userId)) {
      return res.status(400).json({
        error: "Invalid userId. Must be UUID."
      });
    }

    // 3. Ensure wallet exists
    const wallet = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [userId]
    );

    if (wallet.rows.length === 0) {
      await pool.query(
        "INSERT INTO wallets (user_id, balance) VALUES ($1, 0)",
        [userId]
      );
    }

    // 4. Create funding record
    const reference = "FD-" + uuidv4();

    await pool.query(
      `INSERT INTO fundings (user_id, amount, reference, provider, status)
       VALUES ($1, $2, $3, 'monnify', 'pending')`,
      [userId, amount, reference]
    );

    res.json({
      status: "ok",
      reference,
      paymentUrl: `https://sandbox.monnify.com/pay/${reference}`
    });

  } catch (err) {
    console.error("FUNDING ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
