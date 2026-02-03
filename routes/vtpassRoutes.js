const express = require("express");
const router = express.Router();

const wallet = require("../services/walletService");
const treasury = require("../services/treasuryService");
const vtpass = require("../services/vtpassService");

// Airtime
router.post("/airtime", async (req, res) => {
  try {
    const { userId, phone, amount } = req.body;

    if (!userId || !phone || !amount) {
      return res.status(400).json({ error: "Missing fields" });
    }

// 1. Debit user wallet
await wallet.debit(userId, amount, "vtpass-airtime");

// 2. Call VTpass
const result = await vtpass.buyAirtime(phone, amount, "mtn");

// 3. If VTpass fails → trigger rollback
if (result.code !== "000") {
  throw new Error("VTpass failed");
}

// 4. Platform profit (optional for now)
const margin = 50;
await treasury.increaseRevenue(margin);

return res.json({
  status: "success",
  result
});

} catch (err) {
  console.error("VTpass error:", err.message);

  // AUTO REFUND
  if (req.body?.userId && req.body?.amount) {
    await wallet.rollbackDebit(
      req.body.userId,
      req.body.amount,
      "vtpass-failed"
    );
  }

  return res.status(500).json({
    error: "Transaction failed and refunded"
  });
}
});   // closes router.post

module.exports = router;
