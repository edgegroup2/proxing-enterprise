/**
 * VTPASS ROUTES - ATOMIC WALLET INTEGRATION
 * - Auth protected
 * - Debit via walletEngine
 * - Auto refund on provider failure
 */

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/auth");
const walletEngine = require("../engine/walletEngine");
const { processVtpassPurchase } = require("../services/vtpassService");
const { generateRequestId } = require("../utils/requestId");
const logger = require("../utils/logger");

/* ======================================================
   AIRTIME PURCHASE
====================================================== */

router.post("/airtime", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { network, phone, amount } = req.body;

  if (!network || !phone || !amount) {
    return res.status(400).json({ success: false, error: "Missing parameters" });
  }

  const reference = `vtpass_${generateRequestId()}`;

  try {
    // 🔐 1️⃣ DEBIT WALLET FIRST (ATOMIC)
    await walletEngine.debit({
      userId,
      amount,
      reference,
      provider: "vtpass",
    });

    // 📡 2️⃣ CALL VTPASS SERVICE
    const result = await processVtpassPurchase({
      request_id: reference,
      service_id: network,
      product_type: "airtime",
      phone,
      amount,
    });

    logger.info({
      type: "VTPASS_AIRTIME_SUCCESS",
      userId,
      reference,
      amount,
    });

    return res.json({
      success: true,
      reference,
      data: result,
    });

  } catch (err) {

    logger.error({
      error: err.message,
      reference,
      userId,
    }, "VTPASS AIRTIME FAILED");

    // 🔁 REFUND IF NEEDED
    try {
      await walletEngine.credit({
        userId,
        amount,
        reference: `${reference}_refund`,
        provider: "vtpass_refund",
      });
    } catch (refundErr) {
      logger.error(refundErr, "REFUND FAILED");
    }

    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

/* ======================================================
   DATA PURCHASE
====================================================== */

router.post("/data", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { network, phone, variation_code } = req.body;

  if (!network || !phone || !variation_code) {
    return res.status(400).json({ success: false, error: "Missing parameters" });
  }

  const reference = `vtpass_${generateRequestId()}`;

  try {
    // 🔍 You must fetch actual price from variation before debit
    // For now assuming amount sent as 0 and resolved inside service
    const amount = await processVtpassPurchase.getVariationAmount?.(variation_code);

    if (!amount) {
      throw new Error("Invalid variation");
    }

    // 🔐 DEBIT FIRST
    await walletEngine.debit({
      userId,
      amount,
      reference,
      provider: "vtpass",
    });

    // 📡 CALL PROVIDER
    const result = await processVtpassPurchase({
      request_id: reference,
      service_id: network,
      product_type: "data",
      phone,
      variation_code,
      amount,
    });

    logger.info({
      type: "VTPASS_DATA_SUCCESS",
      userId,
      reference,
      amount,
    });

    return res.json({
      success: true,
      reference,
      data: result,
    });

  } catch (err) {

    logger.error({
      error: err.message,
      reference,
      userId,
    }, "VTPASS DATA FAILED");

    // 🔁 REFUND IF NEEDED
    try {
      if (err.message !== "Insufficient balance") {
        await walletEngine.credit({
          userId,
          amount,
          reference: `${reference}_refund`,
          provider: "vtpass_refund",
        });
      }
    } catch (refundErr) {
      logger.error(refundErr, "DATA REFUND FAILED");
    }

    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
