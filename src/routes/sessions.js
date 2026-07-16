'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const sessionEngine = require('../services/sessionEngine');
const presence = require('../services/presenceService');

const router = express.Router();

router.post('/instant', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const providerType = String(req.body.providerType || '').trim();
    const packageId = String(req.body.packageId || '').trim();
    const specialty = req.body.specialty ? String(req.body.specialty).trim() : null;
    const providerId = req.body.providerId ? String(req.body.providerId).trim() : null;

    const result = await sessionEngine.createInstantSession({
      userId,
      providerType,
      specialty,
      packageId,
      providerId,
    });

    // Best-effort: if providerId exists, mark busy so they don't get double-booked
    const pid = result?.providerId || providerId;
    if (pid && providerType) {
      await presence.setBusy({ providerId: pid, providerType, specialty });
    }

    return res.json({ success: true, data: result });
  } catch (e) {
    return res.json({ success: false, error: e.message || 'Failed' });
  }
});

router.post('/end', requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.body.sessionId || '').trim();
    const status = String(req.body.status || 'ended').trim();

    const data = await sessionEngine.endSession({
      sessionId,
      endedBy: req.user.id,
      status,
    });

    // Best-effort: unmarkBusy so providers don't remain stuck
    // Works if engine returns providerId/providerType/specialty, otherwise it silently skips.
    const providerId = data?.providerId || data?.provider?.id;
    const providerType = data?.providerType || data?.provider?.providerType;
    const specialty = data?.specialty || data?.provider?.specialty;

    if (providerId && providerType) {
      await presence.unmarkBusy({
        providerId: String(providerId),
        providerType: String(providerType),
        specialty: specialty ? String(specialty) : null,
      });
    }

    return res.json({ success: true, data });
  } catch (e) {
    return res.json({ success: false, error: e.message || 'Failed' });
  }
});

module.exports = router;
