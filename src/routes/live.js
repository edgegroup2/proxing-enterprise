'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getRedis } = require('../realtime/redisClient');
const { emitEvent } = require('../realtime/bus');

const router = express.Router();

/**
 * Data model (Redis):
 * - stream:<id> hash { sellerId,title,startsAt,status,category,specialty }
 * - streams:scheduled zset score=startsAt value=streamId
 * - stream:viewers:<id> set of userIds (optional if you want)
 * - auction:<streamId> hash { startingBid, highestBid, highestBidder, status }
 * - flash:<streamId> hash { priceFrom, priceTo, units, endsAt, active }
 */

// Schedule stream
router.post('/streams/schedule', requireAuth, async (req, res) => {
  try {
    const sellerId = String(req.user.id);
    const title = String(req.body.title || '').trim();
    const startsAt = Number(req.body.startsAt || 0);
    const category = String(req.body.category || '').trim().toLowerCase();
    const specialty = req.body.specialty ? String(req.body.specialty).trim().toLowerCase() : '';

    if (!title || !startsAt || !category) {
      return res.status(400).json({ success: false, error: 'title, startsAt, category required' });
    }

    const redis = getRedis();
    const streamId = `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    await redis.hSet(`stream:${streamId}`, {
      streamId,
      sellerId,
      title,
      startsAt: String(startsAt),
      status: 'scheduled',
      category,
      specialty,
    });

    await redis.zAdd('streams:scheduled', [{ score: startsAt, value: streamId }]);

    // Notify category room
    await emitEvent({
      type: 'stream:scheduled',
      room: specialty ? `category:${category}:${specialty}` : `category:${category}`,
      payload: { streamId, sellerId, title, startsAt, category, specialty },
    });

    return res.json({ success: true, streamId });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Failed' });
  }
});

// Go live
router.post('/streams/go-live', requireAuth, async (req, res) => {
  try {
    const sellerId = String(req.user.id);
    const streamId = String(req.body.streamId || '').trim();
    if (!streamId) return res.status(400).json({ success: false, error: 'streamId required' });

    const redis = getRedis();
    await redis.hSet(`stream:${streamId}`, { status: 'live' });

    await emitEvent({
      type: 'stream:live',
      room: `stream:${streamId}`,
      payload: { streamId, sellerId },
    });

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Failed' });
  }
});

// Start auction
router.post('/auction/start', requireAuth, async (req, res) => {
  try {
    const streamId = String(req.body.streamId || '').trim();
    const startingBid = Number(req.body.startingBid || 0);
    if (!streamId || !startingBid) {
      return res.status(400).json({ success: false, error: 'streamId + startingBid required' });
    }

    const redis = getRedis();
    await redis.hSet(`auction:${streamId}`, {
      startingBid: String(startingBid),
      highestBid: String(startingBid),
      highestBidder: '',
      status: 'live',
    });

    await emitEvent({
      type: 'auction:started',
      room: `stream:${streamId}`,
      payload: { streamId, startingBid, highestBid: startingBid },
    });

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Failed' });
  }
});

// Place bid
router.post('/auction/bid', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const streamId = String(req.body.streamId || '').trim();
    const bid = Number(req.body.bid || 0);

    if (!streamId || !bid) return res.status(400).json({ success: false, error: 'invalid' });

    const redis = getRedis();
    const a = await redis.hGetAll(`auction:${streamId}`);
    if (!a || a.status !== 'live') {
      return res.status(400).json({ success: false, error: 'auction not live' });
    }

    const current = Number(a.highestBid || a.startingBid || 0);
    if (bid <= current) return res.status(400).json({ success: false, error: 'bid too low' });

    await redis.hSet(`auction:${streamId}`, {
      highestBid: String(bid),
      highestBidder: userId,
    });

    await emitEvent({
      type: 'auction:bid',
      room: `stream:${streamId}`,
      payload: { streamId, bid, userId },
    });

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Failed' });
  }
});

// Flash deal
router.post('/flash/start', requireAuth, async (req, res) => {
  try {
    const streamId = String(req.body.streamId || '').trim();
    const priceFrom = Number(req.body.priceFrom || 0);
    const priceTo = Number(req.body.priceTo || 0);
    const units = Number(req.body.units || 0);
    const durationSec = Number(req.body.durationSec || 60);

    if (!streamId || !priceFrom || !priceTo || !units) {
      return res.status(400).json({ success: false, error: 'invalid flash deal' });
    }

    const endsAt = Date.now() + durationSec * 1000;
    const redis = getRedis();

    await redis.hSet(`flash:${streamId}`, {
      priceFrom: String(priceFrom),
      priceTo: String(priceTo),
      units: String(units),
      endsAt: String(endsAt),
      active: '1',
    });

    await emitEvent({
      type: 'flash:started',
      room: `stream:${streamId}`,
      payload: { streamId, priceFrom, priceTo, units, endsAt },
    });

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'Failed' });
  }
});

module.exports = router;
