/**
 * Paystack Webhook Handler
 * File: src/webhooks/paystack.js
 *
 * IMPORTANT:
 * - RAW body is already handled in index.js
 * - Do NOT use express.json() or express.raw() here
 * - Wallet crediting happens ONLY here
 */

const crypto = require("crypto");
const express = require("express");
const router = express.Router();

const {
  createTransaction,
  markTransactionSuccess,
  isTransactionSuccessful,
} = require("../services/transactionService");

const { creditWallet } = require("../services/walletService");
const logger = require("../logger");

router.post("/", async (req, res) => {
  try {
    /* ---------------- SIGNATURE VALIDATION ---------------- */
    const signature = req.headers["x-paystack-signature"];
    if (!signature) {
      logger.warn("Missing Paystack signature");
      return res.sendStatus(400);
    }

    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      logger.error("PAYSTACK_SECRET_KEY not set");
      return res.sendStatus(500);
    }

    const computedHash = crypto
      .createHmac("sha512", secret)
      .update(req.body)
      .digest("hex");

    if (computedHash !== signature) {
      logger.warn("Invalid Paystack signature");
      return res.sendStatus(401);
    }

    /* ---------------- PARSE EVENT ---------------- */
    const event = JSON.parse(req.body.toString());

    // We only care about successful charges
    if (event.event !== "charge.success") {
      return res.sendStatus(200);
    }

    const data = event.data;

    const reference = data.reference;
    const amount = Number(data.amount) / 100; // Kobo → Naira
    const userId = data.metadata?.user_id;

    /* ---------------- SAFETY CHECKS ---------------- */
    if (!reference || !amount) {
      logger.warn({ data }, "Invalid Paystack payload");
      return res.sendStatus(200);
    }

    if (!userId) {
      logger.warn(
        { reference },
        "Missing user_id in Paystack metadata"
      );
      return res.sendStatus(200);
    }

    /* ---------------- DUPLICATE PROTECTION ---------------- */
    const alreadyProcessed = await isTransactionSuccessful(reference);
    if (alreadyProcessed) {
      logger.warn(
        { reference },
        "Duplicate Paystack webhook ignored"
      );
      return res.sendStatus(200);
    }

    /* ---------------- CREATE TRANSACTION ---------------- */
    await createTransaction({
      userId,
      reference,
      amount,
      channel: "paystack",
      type: "wallet-funding",
      provider: "paystack",
      meta: data,
    });

    /* ---------------- CREDIT WALLET ---------------- */
    await creditWallet({ userId, amount });

    /* ---------------- MARK SUCCESS ---------------- */
    await markTransactionSuccess(reference);

    logger.info(
      { reference, amount, userId },
      "Wallet funded via Paystack"
    );

    return res.sendStatus(200);
  } catch (err) {
    logger.error(err, "Paystack webhook processing error");
    return res.sendStatus(500); // Never crash server
  }
});

module.exports = router;
