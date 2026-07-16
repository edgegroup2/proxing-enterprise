'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getRedis } = require('../realtime/redisClient');

const router = express.Router();
const STREAM = 'proxing:match:requests';

router.post('/request', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const providerType = String(req.body.providerType || '').trim();
    const specialty = req.body.specialty ? String(req.body.specialty).trim() : '';

    if (!providerType) {
      return res.status(400).json({ success: false, error: 'providerType required' });
    }

    const redis = getRedis();
    const id = await redis.xAdd(
      STREAM,
      '*',
      {
        userId,
        providerType,
        specialty,
        ts: String(Date.now()),
      }
    );

    return res.json({ success: true, requestId: id });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'match request failed' });
  }
});

module.exports = router;
