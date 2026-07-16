'use strict';

const { getRedis } = require('./redisClient');

function now() { return Date.now(); }

// A simple trending score (v1):
// viewers * 3 + bids * 5 + purchases * 10 + comments * 1 + recencyBoost
function computeTrendingScore(meta) {
  const viewers = Number(meta.viewers || 0);
  const bids = Number(meta.bids || 0);
  const purchases = Number(meta.purchases || 0);
  const comments = Number(meta.comments || 0);

  const ageMs = Math.max(1, now() - Number(meta.startedAt || now()));
  const recencyBoost = Math.max(0, 5000 - Math.floor(ageMs / 60000)); // decays per minute

  return viewers * 3 + bids * 5 + purchases * 10 + comments * 1 + recencyBoost;
}

async function indexStreamLive(stream) {
  const redis = getRedis();
  const key = `stream:${stream.id}`;

  await redis.hset(key, {
    id: stream.id,
    sellerId: stream.sellerId || '',
    title: stream.title || '',
    category: stream.category || '',
    specialty: stream.specialty || '',
    startedAt: String(stream.startedAt || now()),
    status: 'live'
  });

  // initialize engagement counters if missing
  await redis.hsetnx(key, 'viewers', '0');
  await redis.hsetnx(key, 'bids', '0');
  await redis.hsetnx(key, 'purchases', '0');
  await redis.hsetnx(key, 'comments', '0');

  const meta = await redis.hgetall(key);
  const score = computeTrendingScore(meta);

  await redis.zadd('streams:live', score, stream.id);
}

async function unindexStreamLive(streamId) {
  const redis = getRedis();
  await redis.zrem('streams:live', streamId);
  await redis.hset(`stream:${streamId}`, 'status', 'ended');
}

async function indexStreamScheduled(stream) {
  const redis = getRedis();
  const key = `stream:${stream.id}`;

  await redis.hset(key, {
    id: stream.id,
    sellerId: stream.sellerId || '',
    title: stream.title || '',
    category: stream.category || '',
    specialty: stream.specialty || '',
    startsAt: String(stream.startsAt || now()),
    status: 'scheduled'
  });

  await redis.zadd('streams:scheduled', Number(stream.startsAt || now()), stream.id);
}

async function unindexStreamScheduled(streamId) {
  const redis = getRedis();
  await redis.zrem('streams:scheduled', streamId);
}

async function bumpStreamMetric(streamId, field, inc) {
  const redis = getRedis();
  const key = `stream:${streamId}`;
  await redis.hincrby(key, field, inc);

  const meta = await redis.hgetall(key);
  const score = computeTrendingScore(meta);
  await redis.zadd('streams:live', score, streamId);
}

async function setStreamViewers(streamId, viewers) {
  const redis = getRedis();
  const key = `stream:${streamId}`;
  await redis.hset(key, 'viewers', String(viewers));

  const meta = await redis.hgetall(key);
  const score = computeTrendingScore(meta);
  await redis.zadd('streams:live', score, streamId);
}

async function indexAuctionLive(auction) {
  const redis = getRedis();
  const key = `auction:${auction.id}`;

  await redis.hset(key, {
    id: auction.id,
    streamId: auction.streamId,
    endAt: String(auction.endAt),
    highestBid: String(auction.highestBid || 0),
    status: 'live'
  });

  // score: ending sooner gets higher priority
  const timeLeft = Math.max(1, Number(auction.endAt) - now());
  const score = 1_000_000_000 - Math.floor(timeLeft / 1000); // smaller timeLeft => bigger score
  await redis.zadd('auctions:live', score, auction.id);
}

async function bumpAuctionBid(auctionId, amount) {
  const redis = getRedis();
  const key = `auction:${auctionId}`;
  await redis.hset(key, 'highestBid', String(amount));
  // no-op: you can also bump ranking if needed
}

async function indexFlashDeal(deal) {
  const redis = getRedis();
  const key = `flash:${deal.id}`;

  await redis.hset(key, {
    id: deal.id,
    streamId: deal.streamId,
    oldPrice: String(deal.oldPrice),
    newPrice: String(deal.newPrice),
    unitsLeft: String(deal.unitsLeft),
    expiresAt: String(deal.expiresAt),
    status: 'active'
  });

  await redis.zadd('flash:active', Number(deal.expiresAt), deal.id);
}

async function updateFlashDeal(dealId, patch) {
  const redis = getRedis();
  const key = `flash:${dealId}`;
  if (patch.unitsLeft !== undefined) await redis.hset(key, 'unitsLeft', String(patch.unitsLeft));
  if (patch.expiresAt !== undefined) await redis.hset(key, 'expiresAt', String(patch.expiresAt));
  if (patch.newPrice !== undefined) await redis.hset(key, 'newPrice', String(patch.newPrice));
  if (patch.expiresAt !== undefined) await redis.zadd('flash:active', Number(patch.expiresAt), dealId);
}

async function expireFlashDeals() {
  const redis = getRedis();
  const expired = await redis.zrangebyscore('flash:active', 0, now());
  if (!expired.length) return;

  for (const id of expired) {
    await redis.zrem('flash:active', id);
    await redis.hset(`flash:${id}`, 'status', 'expired');
  }
}

module.exports = {
  indexStreamLive,
  unindexStreamLive,
  indexStreamScheduled,
  unindexStreamScheduled,
  bumpStreamMetric,
  setStreamViewers,
  indexAuctionLive,
  bumpAuctionBid,
  indexFlashDeal,
  updateFlashDeal,
  expireFlashDeals
};
