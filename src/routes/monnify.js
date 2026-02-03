const express = require("express");
const router = express.Router();
const pool = require("../db");

console.log("🔥 MONNIFY ROUTER LOADED");

// Monnify webhook
router.post("/webhook", async (req, res) => {
  try {
    const data = req.body.eventData;

    // ✅ THIS WAS THE BUG
    const reference = data.paymentReference;
    const amountPaid = Number(data.amountPaid);

    console.log("📩 Webhook received:", reference, amountPaid);

    // 1. Find funding record
    const fundingRes = await pool.query(
      "SELECT * FROM fundings WHERE reference = $1",
      [reference]
    );

    if (fundingRes.rowCount === 0) {
      console.log("❌ Funding not found for ref:", reference);
      return res.status(400).json({ error: "Funding reference not found" });
    }

    const funding = fundingRes.rows[0];
    const userId = funding.user_id;

    // 2. Credit wallet
    await pool.query(
      "UPDATE wallets SET balance = balance + $1 WHERE user_id = $2",
      [amountPaid, userId]
    );

    // 3. Mark funding as paid
    await pool.query(
      "UPDATE fundings SET status = 'paid' WHERE reference = $1",
      [reference]
    );

    console.log("✅ Wallet credited for user:", userId);

    res.json({ status: "success" });
  } catch (err) {
    console.error("WEBHOOK ERROR", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
