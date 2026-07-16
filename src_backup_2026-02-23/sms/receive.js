// src/sms/receive.js

const express = require("express");
const router = express.Router();

const { parseIntent } = require("./intentParser");
const { routeIntent } = require("./intentRouter");

router.post("/receive", async (req, res) => {
  try {
    const { message, from } = req.body;

    if (!message || !from) {
      return res.status(400).json({ error: "Invalid SMS payload" });
    }

    const intent = await parseIntent(message);

    if (!intent) {
      return res.json({
        status: "ignored",
        reason: "Unable to detect intent",
      });
    }

    await routeIntent(intent, from);

    res.json({
      status: "processed",
      intent,
    });
  } catch (err) {
    console.error("❌ SMS processing error:", err.message);
    res.status(500).json({ error: "SMS processing failed" });
  }
});

module.exports = router;
