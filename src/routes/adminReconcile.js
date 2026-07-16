"use strict";

const express = require("express");
const router = express.Router();

const { reconcileCommissions } = require("../jobs/commissionReconcile");

// Simple token auth (matches what you're already using)
function requireAdmin(req, res, next) {
  const token =
    req.headers["x-admin-token"] ||
    (req.headers.authorization || "").replace("Bearer ", "");

  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// Run reconcile (optionally limit batch size)
router.post("/reconcile-commissions", requireAdmin, async (req, res) => {
  try {
    const limit = Number(req.body?.limit) || 200; // safe default
    const result = await reconcileCommissions({ limit });
    return res.json({ ok: true, result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
