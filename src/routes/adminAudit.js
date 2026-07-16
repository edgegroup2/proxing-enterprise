const express = require("express");
const router = express.Router();
const { runReconciliation } = require("../cron/reconciliation");
const authModule = require('../middleware/auth');

const authMiddleware =
  typeof authModule === 'function'
    ? authModule
    : (authModule.requireAuth ||
       authModule.authMiddleware ||
       authModule.auth ||
       authModule.userAuth ||
       authModule.default);

if (typeof authMiddleware !== 'function') {
  throw new Error(
    `Auth middleware is not a function. Exported keys: ${Object.keys(authModule || {}).join(', ')}`
  );
}
router.post("/reconcile", authMiddleware, async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  await runReconciliation();

  res.json({ success: true, message: "Reconciliation executed" });
});

module.exports = router;
