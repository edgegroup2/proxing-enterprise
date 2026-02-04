const express = require("express");
const router = express.Router();
const { creditWallet } = require("../engine/walletEngine");

router.post("/monnify/webhook", async (req, res) => {
  try {
    console.log("🔔 Monnify Webhook Received:", req.body);

    const data = req.body.eventData;

    if (data && data.paymentStatus === "PAID") {
      const userId = data.accountReference;
      const amount = data.amountPaid;
      const ref = data.transactionReference;

      await creditWallet(userId, amount, ref);
      console.log("💰 Wallet credited:", userId, amount);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Monnify webhook error:", err.message);
    return res.sendStatus(500);
  }
});

module.exports = router;
