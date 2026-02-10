const crypto = require("crypto");
const express = require("express");
const router = express.Router();

// ✅ Adjust ONLY if your DB file is elsewhere
const db = require("../../database");

router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      /* ===============================
         1️⃣ VERIFY PAYSTACK SIGNATURE
      =============================== */
      const signature = req.headers["x-paystack-signature"];

      if (!signature) {
        return res.status(400).send("Missing Paystack signature");
      }

      const hash = crypto
        .createHmac("sha512", process.env.PAYSTACK_WEBHOOK_SECRET)
        .update(req.body)
        .digest("hex");

      if (hash !== signature) {
        return res.status(401).send("Invalid Paystack signature");
      }

      /* ===============================
         2️⃣ PARSE EVENT SAFELY
      =============================== */
      const event = JSON.parse(req.body.toString());

      if (event.event !== "charge.success") {
        return res.sendStatus(200);
      }

      const { reference, amount } = event.data;
      const creditedAmount = amount / 100;

      /* ===============================
         3️⃣ SAFETY CHECKS (MANDATORY)
      =============================== */
      const payment = await db.payments.findOne({ reference });

      // Unknown reference OR already processed → ignore
      if (!payment || payment.status === "completed") {
        return res.sendStatus(200);
      }

      /* ===============================
         4️⃣ CREDIT WALLET (ONLY HERE)
      =============================== */
      await db.wallets.credit(payment.userId, creditedAmount);

      await db.payments.update(reference, {
        status: "completed",
        paidAt: new Date(),
      });

      return res.sendStatus(200);
    } catch (error) {
      console.error("🔥 Paystack Webhook Error:", error);
      return res.sendStatus(500);
    }
  }
);

module.exports = router;
