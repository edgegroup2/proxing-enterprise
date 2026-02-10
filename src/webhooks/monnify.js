// src/webhooks/monnify.js
const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const {
  createTransaction,
  markTransactionSuccess,
  isTransactionSuccessful,
} = require("../services/transactionService");

const { creditWallet } = require("../services/walletService");
const logger = require("../logger");

/**
 * Verify Monnify webhook signature
 */
function verifySignature(req) {
  const signature = req.headers["monnify-signature"];
  if (!signature) return false;

  const secret = process.env.MONNIFY_WEBHOOK_SECRET;
  if (!secret) throw new Error("MONNIFY_WEBHOOK_SECRET missing");

  const computedHash = crypto
    .createHmac("sha512", secret)
    .update(req.rawBody) // ✅ MUST be raw body
    .digest("hex");

  return computedHash === signature;
}

router.post("/monnify", async (req, res) => {
  try {
    // 1️⃣ Verify signature
    if (!verifySignature(req)) {
      logger.error("Invalid Monnify signature");
      return res.status(401).send("Invalid signature");
    }

    const event = req.body;

    // 2️⃣ Only process successful transactions
    if (event.eventType !== "SUCCESSFUL_TRANSACTION") {
      return res.sendStatus(200);
    }

    const data = event.eventData;
    const reference = data.transactionReference;
    const amount = Number(data.amountPaid);

    if (!reference || !amount) {
      logger.error({ data }, "Invalid Monnify payload");
      return res.sendStatus(400);
    }

    // 3️⃣ Idempotency check
    if (await isTransactionSuccessful(reference)) {
      logger.warn({ reference }, "Duplicate Monnify webhook ignored");
      return res.sendStatus(200);
    }

    // 4️⃣ Create transaction record
    await createTransaction({
      userId: null, // ✅ System funding (safe)
      reference,
      amount,
      channel: "monnify",
      type: "wallet_funding",
      provider: "monnify",
      meta: data,
    });

    // 5️⃣ Credit system wallet
    await creditWallet({
      userId: null,
      amount,
      reference,
      source: "monnify",
    });

    // 6️⃣ Mark success
    await markTransactionSuccess(reference);

    logger.info(
      { reference, amount },
      "Wallet funded via Monnify"
    );

    return res.sendStatus(200);
  } catch (err) {
    logger.error(err, "Monnify webhook fatal error");
    return res.sendStatus(500);
  }
});

module.exports = router;
