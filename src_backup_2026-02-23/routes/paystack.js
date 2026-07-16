/**
 * PAYSTACK ROUTES - ENTERPRISE PRODUCTION VERSION
 * - Secure backend initialization
 * - HMAC SHA512 webhook verification
 * - Idempotent wallet credit
 * - Metadata enforced
 * - Safe logging
 */

const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const router = express.Router();

const walletEngine = require("../engine/walletEngine");
const logger = require("../utils/logger");

// 🔐 IMPORTANT: Replace with your actual auth middleware if different
const authMiddleware = require("../middleware/auth");

/* ======================================================
   1️⃣ SECURE BACKEND INITIALIZATION
====================================================== */

router.post("/init", authMiddleware, async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { amount } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: user.email,
        amount: Number(amount) * 100, // Paystack uses kobo
        metadata: {
          user_id: user.id, // 🔥 SYSTEM CONTROLLED
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.json({
      authorization_url: response.data.data.authorization_url,
      reference: response.data.data.reference,
    });

  } catch (err) {
    logger.error(
      {
        error: err.response?.data || err.message,
      },
      "🔥 Paystack initialization error"
    );

    return res.status(500).json({ error: "Payment initialization failed" });
  }
});

/* ======================================================
   2️⃣ PAYSTACK WEBHOOK (HARDENED)
====================================================== */

router.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"];

    if (!signature) {
      logger.warn("❌ Missing Paystack signature header");
      return res.sendStatus(200);
    }

    // 🔐 Verify HMAC SHA512 signature
    const expectedHash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(req.body)
      .digest("hex");

    if (signature !== expectedHash) {
      logger.warn("❌ Invalid Paystack signature");
      return res.sendStatus(200);
    }

    const event = JSON.parse(req.body.toString());

    // Only handle successful charge events
    if (event.event !== "charge.success") {
      return res.sendStatus(200);
    }

    if (!event.data || event.data.status !== "success") {
      return res.sendStatus(200);
    }

    const reference = event.data.reference;
    const amountInKobo = event.data.amount;
    const metadata = event.data.metadata;

    if (!reference || !metadata?.user_id) {
      logger.error("❌ Missing reference or user_id in metadata");
      return res.sendStatus(200);
    }

    const userId = metadata.user_id;
    const amount = Number(amountInKobo) / 100;

    if (!amount || amount <= 0) {
      logger.error("❌ Invalid Paystack amount received");
      return res.sendStatus(200);
    }

    // 💰 Idempotent wallet credit
    await walletEngine.credit({
      userId,
      amount,
      reference: `paystack_${reference}`,
      provider: "paystack",
    });

    logger.info({
      type: "PAYSTACK_CREDIT_SUCCESS",
      userId,
      reference,
      amount,
    });

    return res.sendStatus(200);

  } catch (err) {
    logger.error(
      {
        error: err.message,
        stack: err.stack,
      },
      "🔥 PAYSTACK WEBHOOK ERROR"
    );

    // Always return 200 to prevent retry storm
    return res.sendStatus(200);
  }
});

module.exports = router;
