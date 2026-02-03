const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const wallet = require("../../services/walletService");
const treasury = require("../../services/treasuryService");
const db = require("../../services/db"); // your supabase / db client

router.post("/", async (req, res) => {
  try {
    // 1. Verify Monnify signature
    const signature = req.headers["x-monnify-signature"];
    const payload = JSON.stringify(req.body);

    const computedHash = crypto
      .createHmac("sha512", process.env.MONNIFY_WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    if (signature !== computedHash) {
      console.log("❌ Invalid Monnify signature");
      return res.status(401).json({ message: "Invalid signature" });
    }

    console.log("✅ MONNIFY WEBHOOK RECEIVED");
    console.log(req.body);

    const event = req.body.eventType;
    const data = req.body.eventData;

    // Only handle successful payments
    if (
      event === "SUCCESSFUL_TRANSACTION" ||
      event === "SUCCESSFUL_COLLECTION"
    ) {
      const reference = data.paymentReference; // PROXING-XXXX
      const amount = parseInt(data.amountPaid);

      console.log("Processing funding:", reference, amount);

      // 2. Find funding record
      const { rows } = await db.query(
        "SELECT * FROM fundings WHERE reference = $1",
        [reference]
      );

      if (rows.length === 0) {
        console.log("❌ Unknown reference:", reference);
        return res.json({ status: "ignored" });
      }

      const funding = rows[0];

      // 3. Idempotency check (CRITICAL)
      if (funding.status === "COMPLETED") {
        console.log("⚠️ Already credited:", reference);
        return res.json({ status: "already_processed" });
      }

      // 4. Credit wallet
      await wallet.credit(funding.user_id, amount);

      // 5. Update funding status
      await db.query(
        "UPDATE fundings SET status = 'COMPLETED' WHERE reference = $1",
        [reference]
      );

      // 6. Treasury float
      await treasury.increaseFloat(amount);

      console.log("💰 Wallet credited successfully:", {
        user_id: funding.user_id,
        reference,
        amount
      });
    }

    return res.json({ status: "ok" });
  } catch (err) {
    console.error("Monnify Webhook Error:", err);
    return res.status(500).json({ status: "error" });
  }
});

module.exports = router;
