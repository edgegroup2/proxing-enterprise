const express = require("express");
const router = express.Router();
const db = require("../db");
const authMiddleware = require("../middleware/auth");

/**
 * GET AUTHENTICATED USER WALLET BALANCE
 * Source of truth: wallets table (ledger auto-updated)
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT balance FROM wallets WHERE user_id = $1",
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    return res.json({
      balance: rows[0].balance,
    });

  } catch (err) {
    console.error("Wallet fetch error:", err);
    return res.status(500).json({ error: "Failed to fetch wallet" });
  }
});

module.exports = router;
