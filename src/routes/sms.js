const express = require('express');
const router = express.Router();

router.post('/sms', (req, res) => {
  // Support all common SMS forwarder formats
  const from =
    req.body.from ||
    req.body.sender ||
    req.body.number ||
    "unknown";

  const message =
    req.body.message ||
    req.body.text ||
    req.body.body ||
    "empty";

  console.log("📩 SMS RECEIVED");
  console.log("From:", from);
  console.log("Message:", message);
  console.log("Raw payload:", req.body);

  // AI brain hook point
  // NLP → intent → VTpass → wallet → reply

  res.status(200).json({
    status: "ok",
    received: true
  });
});

module.exports = router;
