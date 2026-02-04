const express = require("express");
const router = express.Router();

// Health check
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "ProxiNG",
    time: new Date().toISOString()
  });
});

module.exports = router;
