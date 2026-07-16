const express = require("express");
const router = express.Router();
const { runReconciliation } = require("../cron/reconciliation");
const authMiddleware = require("../middleware/auth");

router.post("/reconcile", authMiddleware, async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  await runReconciliation();

  res.json({ success: true, message: "Reconciliation executed" });
});

module.exports = router;
