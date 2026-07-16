'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../utils/logger');

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
  throw new Error(`Auth middleware is not a function. Exported keys: ${Object.keys(authModule || {}).join(', ')}`);
}

const { setOnline, heartbeat, setOffline } = require('../services/presenceService');

function normType(v) {
  return String(v || '').trim().toLowerCase();
}

/**
 * POST /api/provider/online
 * Body: { providerType, specialty? }
 * Requires: logged in user with role='provider'
 */
router.post('/online', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const u = await db.query(`SELECT id, role FROM users WHERE id=$1 LIMIT 1`, [userId]);
    const user = u.rows[0];
    if (!user || user.role !== 'provider') {
      return res.status(403).json({ success: false, error: 'Only providers can go online' });
    }

    const providerType = normType(req.body?.providerType);
    const specialty = req.body?.specialty ? String(req.body.specialty).trim() : null;
    if (!providerType) return res.status(400).json({ success: false, error: 'providerType required' });

    await setOnline({ providerId: userId, providerType, specialty });

    return res.json({ success: true, data: { providerId: userId, providerType, specialty } });
  } catch (e) {
    logger.error({ type: 'PROVIDER_ONLINE_ERROR', error: e?.message, stack: e?.stack });
    return res.status(500).json({ success: false, error: e?.message || 'Failed' });
  }
});

/**
 * POST /api/provider/heartbeat
 * Body: {}
 */
router.post('/heartbeat', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const u = await db.query(`SELECT id, role FROM users WHERE id=$1 LIMIT 1`, [userId]);
    const user = u.rows[0];
    if (!user || user.role !== 'provider') {
      return res.status(403).json({ success: false, error: 'Only providers can heartbeat' });
    }

    const hb = await heartbeat({ providerId: userId });
    return res.json({ success: true, data: hb });
  } catch (e) {
    logger.error({ type: 'PROVIDER_HEARTBEAT_ERROR', error: e?.message, stack: e?.stack });
    return res.status(500).json({ success: false, error: e?.message || 'Failed' });
  }
});

/**
 * POST /api/provider/offline
 * Body: { providerType, specialty? }
 */
router.post('/offline', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const u = await db.query(`SELECT id, role FROM users WHERE id=$1 LIMIT 1`, [userId]);
    const user = u.rows[0];
    if (!user || user.role !== 'provider') {
      return res.status(403).json({ success: false, error: 'Only providers can go offline' });
    }

    const providerType = normType(req.body?.providerType);
    const specialty = req.body?.specialty ? String(req.body.specialty).trim() : null;
    if (!providerType) return res.status(400).json({ success: false, error: 'providerType required' });

    await setOffline({ providerId: userId, providerType, specialty });
    return res.json({ success: true });
  } catch (e) {
    logger.error({ type: 'PROVIDER_OFFLINE_ERROR', error: e?.message, stack: e?.stack });
    return res.status(500).json({ success: false, error: e?.message || 'Failed' });
  }
});

module.exports = router;
