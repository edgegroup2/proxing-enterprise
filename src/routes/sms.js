// src/routes/sms.js
const express = require("express");
const router = express.Router();
const processCommand = require("../services/smsProcessor");

router.post("/inbound", async (req, res) => {
  try {
    const { from, sms } = req.body;

    console.log("SMS FROM:", from);
    console.log("SMS TEXT:", sms);

    const result = await processCommand(from, sms);

    // We DO NOT send SMS back (VTpass already notifies user)
    res.json({
      status: "ok",
      result
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "SMS processing failed" });
  }
});

module.exports = router;
