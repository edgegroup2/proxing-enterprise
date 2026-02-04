const express = require("express");
const router = express.Router();
const { processSms } = require("../services/smsProcessor");

router.post("/inbound", async (req, res) => {
  try {
    const { msisdn, message } = req.body;

    const result = await processSms(msisdn, message);

    res.json({
      success: true,
      received: { msisdn, message },
      result
    });
  } catch (err) {
    console.error("SMS ERROR:", err);
    res.status(500).json({ error: "SMS processing failed" });
  }
});

module.exports = router;
