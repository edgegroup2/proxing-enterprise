const express = require("express");
const crypto = require("crypto");

const router = express.Router();

/**
 * Paystack webhook
 * Raw body is required (already handled in index.js)
 */
router.post("/", (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;

  if (!secret) {
    console.error("❌ PAYSTACK_SECRET_KEY missing");
    return res.sendStatus(500);
  }

  const hash = crypto
    .createHmac("sha512", secret)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    console.warn("⚠️ Invalid Paystack signature");
    return res.sendStatus(400);
  }

  const event = req.body;
  console.log("✅ Paystack webhook received:", event.event);

  // TODO: route event to reconciliation engine if needed

  res.sendStatus(200);
});

module.exports = router;
