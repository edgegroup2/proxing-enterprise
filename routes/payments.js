const express = require("express");
const axios = require("axios");

const router = express.Router();

/**
 * Safety check – prevents Node crash
 */
if (!process.env.PAYSTACK_SECRET_KEY) {
  console.error("❌ PAYSTACK_SECRET_KEY missing in env");
}
if (!process.env.PAYSTACK_BASE_URL) {
  console.error("❌ PAYSTACK_BASE_URL missing in env");
}

/**
 * INITIATE PAYSTACK PAYMENT
 * POST /api/payments/paystack/initiate
 */
router.post("/paystack/initiate", async (req, res) => {
  try {
    const { amount, email } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        error: "Valid amount is required",
      });
    }

    // Auto-generate email if user has none
    const customerEmail =
      email || `wallet_${Date.now()}@proxing.online`;

    const response = await axios.post(
      `${process.env.PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        email: customerEmail,
        amount: Number(amount) * 100, // kobo
        metadata: {
          source: "wallet_funding",
          platform: "ProxiNG",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    return res.json({
      success: true,
      authorization_url: response.data.data.authorization_url,
      reference: response.data.data.reference,
    });
  } catch (err) {
    console.error(
      "❌ Paystack init error:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      success: false,
      error: "Paystack initialization failed",
    });
  }
});

module.exports = router;
