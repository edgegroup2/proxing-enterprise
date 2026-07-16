// src/routes/sms.js
const express = require("express");
const router = express.Router();

const { parseIntent } = require("../ai/intentParser");
const { executeTransaction } = require("../engine/transactionEngine");
const { updateUserProfile } = require("../ai/userProfileStore");
const { suggestIfAmbiguous } = require("../ai/llmSuggestor");

router.post("/sms", async (req, res) => {
  try {
    // -----------------------------
    // Extract message
    // -----------------------------
    const message =
      req.body.message ||
      req.body.text ||
      req.body.sms ||
      req.body.content ||
      "";

    const from =
      req.body.from ||
      req.body.sender ||
      req.body.phone ||
      "unknown";

    console.log("📩 SMS RECEIVED");
    console.log("From:", from);
    console.log("Message:", message);

    // -----------------------------
    // HARD NOISE FILTER
    // -----------------------------
    if (!message || message.trim().length < 6) {
      console.log("🛑 Ignored short/system message:", message);
      return res.json({ status: "ignored" });
    }

    const lower = message.toLowerCase();

    if (
      lower.includes("last sms was charged") ||
      lower.includes("main bal") ||
      lower.includes("dial *") ||
      lower.includes("promo") ||
      lower === "airtel" ||
      lower === "mtn" ||
      lower === "glo" ||
      lower === "9mobile"
    ) {
      console.log("🛑 Ignored telco/system message");
      return res.json({ status: "ignored" });
    }

    // -----------------------------
    // AI INTENT PARSER
    // -----------------------------
    const intent = parseIntent(message, from);
    console.log("🤖 INTENT:", intent);

    // -----------------------------
    // LLM SUGGESTION LAYER (SAFE)
    // -----------------------------
    const suggestion = await suggestIfAmbiguous(intent, message);
    if (suggestion) {
      console.log("💡 LLM Suggestion:", suggestion);
      return res.json({
        status: "suggestion",
        message: suggestion,
      });
    }

    // -----------------------------
    // EXECUTE TRANSACTION
    // -----------------------------
    const result = await executeTransaction(intent);
    console.log("✅ RESULT:", result);

    // -----------------------------
    // SAVE USER MEMORY (ONLY ON SUCCESS)
    // -----------------------------
    if (result.status === "success") {
      updateUserProfile(from, intent);
      console.log("🧠 User profile updated");
    }

    return res.json(result);
  } catch (error) {
    console.error("❌ ERROR:", error.message);
    return res.json({
      status: "error",
      message: error.message,
    });
  }
});

module.exports = router;
