const express = require("express");
const axios = require("axios");
const router = express.Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// Verify Paystack transaction
router.get("/paystack/verify/:reference", async (req, res) => {
  const { reference } = req.params;

  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
        },
      }
    );

    const data = response.data.data;

    if (data.status !== "success") {
      return res.status(400).json({
        success: false,
        message: "Payment not successful",
      });
    }

    // 🔒 IMPORTANT: prevent double credit
    const alreadyCredited = await isReferenceProcessed(reference);
    if (alreadyCredited) {
      return res.json({ success: true, message: "Already processed" });
    }

    const amount = data.amount / 100; // kobo → naira
    const email = data.customer.email;

    await creditWallet({
      email,
      amount,
      reference,
      channel: "paystack",
    });

    res.json({
      success: true,
      message: "Wallet funded successfully",
    });
  } catch (err) {
    console.error("Paystack verify error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Verification failed" });
  }
});

module.exports = router;
