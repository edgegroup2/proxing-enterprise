const express = require("express");
const router = express.Router();
const { processSms } = require("../services/smsProcessor");

// SMS inbound endpoint
router.post("/inbound", async (req, res) => {
  try {
    const { msisdn, message } = req.body;

    if (!msisdn || !message) {
      return res.status(400).json({
        error: "msisdn and message are required"
      });
    }

    const result = await processSms(msisdn, message);

    res.json({
      success: true,
      received: { msisdn, message },
      result
    });
  } catch (err) {
    console.error("SMS ERROR:", err.message);
    res.status(500).json({ error: "SMS processing failed" });
  }
});

module.exports = router;
