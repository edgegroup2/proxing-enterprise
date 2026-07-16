'use strict';

const express = require('express');
const { getRedis } = require('../realtime/redisClient');

const router = express.Router();

/**
 * Discovery endpoints:
 * - /api/discovery/online?category=education&specialty=math
 * - /api/discovery/categories?list=education,health,artisan,driver
 * - /api/discovery/streams/scheduled?limit=20
 */

router.get('/online', async (req, res) => {
  try {
    const redis = getRedis();
    const category = String(req.query.category || '').trim().toLowerCase();
    const specialty = req.query.specialty ? String(req.query.specialty).trim().toLowerCase() : '';

    if (!category) return res.status(400).json({ success: false, error: 'category required' });

    const key = specialty ? `online:${category}:${specialty}` : `online:${category}`;
    const now = Date.now();

    // Return recent (still within TTL window). Cleanup handled in presenceService too, but safe here:
    const ttl = Number(process.env.PRESENCE_TTL_MS || 45000);
    const cutoff = now - ttl;
    await redis.zRemRangeByScore(key, 0, cutoff);

    const ids = await redis.zRange(key, 0, 50, { REV: true });
    return res.json({ success: true, key, count: ids.length, ids });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Failed' });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const redis = getRedis();
    const list = String(req.query.list || '').trim();
    const categories = list ? list.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) : [];

    const ttl = Number(process.env.PRESENCE_TTL_MS || 45000);
    const cutoff = Date.now() - ttl;

    const out = [];
    for (const c of categories) {
      const key = `online:${c}`;
      await redis.zRemRangeByScore(key, 0, cutoff);
      const count = await redis.zCard(key);
      out.push({ category: c, count });
    }
    return res.json({ success: true, categories: out });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Failed' });
  }
});

router.get('/streams/scheduled', async (req, res) => {
  try {
    const redis = getRedis();
    const limit = Math.min(Number(req.query.limit || 20), 50);

    const ids = await redis.zRange('streams:scheduled', 0, limit - 1, { REV: false });
    const streams = [];
    for (const id of ids) {
      const meta = await redis.hGetAll(`stream:${id}`);
      if (meta && meta.streamId) streams.push(meta);
    }

    return res.json({ success: true, streams });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Failed' });
  }
});

module.exports = router;
