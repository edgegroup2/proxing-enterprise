const express = require("express");
const router = express.Router();

const { isDuplicateSMS } = require("../utils/smsLock");
const { buyAirtime, buyData } = require("../services/vtpass");

// POST /api/sms
router.post("/sms", async (req, res) => {
  try {
    const from = (req.body.from || "").trim();
    const message = (req.body.message || "").trim();

    console.log("📩 RAW SMS PAYLOAD:", { from, message });

    // 🔐 DUPLICATE SMS LOCK (VERY IMPORTANT)
    if (isDuplicateSMS(from, message)) {
      console.log("🔁 DUPLICATE SMS BLOCKED:", { from, message });
      return res.json({ status: "ignored_duplicate" });
    }

    console.log("✅ SMS RECEIVED:", { from, message });

    const tokens = message.toLowerCase().split(/\s+/);

    const action = tokens[0]; // buy
    const service = tokens[1]; // airtel, mtn
    const value = tokens[2]; // amount OR "data"
    const target = tokens[3]; // phone OR plan
    const phone = tokens[4] || target;

    // ===============================
    // AIRTIME
    // ===============================
    if (action === "buy" && service && value && phone && value !== "data") {
      console.log("💰 AIRTIME REQUEST:", {
        network: service,
        amount: value,
        phone
      });

      const result = await buyAirtime({
        network: service,
        amount: value,
        phone
      });

      return res.json({
        status: "airtime_sent",
        vtpass: result
      });
    }

    // ===============================
    // DATA
    // ===============================
    if (action === "buy" && service && value === "data") {
      const plan = target;
      const phoneNumber = phone;

      if (!plan || !phoneNumber) {
        return res.json({
          error: "Invalid data format. Example: Buy Airtel Data 1GB 09014631669"
        });
      }

      const serviceID = `${service}-data-${plan}`;

      console.log("📶 DATA REQUEST:", {
        serviceID,
        phone: phoneNumber
      });

      const result = await buyData({
        serviceID,
        phone: phoneNumber
      });

      return res.json({
        status: "data_sent",
        vtpass: result
      });
    }

    // ===============================
    // UNKNOWN
    // ===============================
    console.warn("⚠️ UNKNOWN COMMAND:", message);
    return res.json({
      error: "Unknown command"
    });

  } catch (error) {
    console.error("❌ SMS HANDLER ERROR:", error?.response?.data || error.message);
    return res.status(500).json({
      error: "Internal server error"
    });
  }
});

module.exports = router;
