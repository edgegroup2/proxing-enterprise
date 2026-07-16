'use strict';

const express = require('express');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const db = require('../db');
const { pushJobs } = require('../jobs/pushHighlightJobs');
const { getCostStats } = require('../services/aiCostGuard');

const router = express.Router();

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const QUEUE_NAME = process.env.AI_HIGHLIGHT_QUEUE_NAME || 'highlight-jobs';

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const queue = new Queue(QUEUE_NAME, { connection });

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.adminToken;
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'admin_required' });
  }
  next();
}

router.use(requireAdmin);

router.get('/stats', async (req, res) => {
  const queueCounts = await queue.getJobCounts();

  const dbStats = await db.query(`
    SELECT status, pushed_to_queue, COUNT(*)::int
    FROM ai_highlight_jobs
    GROUP BY status, pushed_to_queue
    ORDER BY status, pushed_to_queue
  `);

  const latest = await db.query(`
    SELECT status, processed_at, last_error
    FROM ai_highlight_jobs
    ORDER BY processed_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  `);

  res.json({
    queue: queueCounts,
    database: dbStats.rows,
    latest: latest.rows[0] || null,
  });
});

router.get('/failed', async (req, res) => {
  const result = await db.query(`
    SELECT
      j.id,
      j.exam_type,
      j.subject_id,
      j.topic_id,
      s.name AS subject_name,
      t.name AS topic_name,
      j.status,
      j.retry_count,
      j.last_error,
      j.created_at,
      j.processed_at
    FROM ai_highlight_jobs j
    LEFT JOIN subjects s ON s.id = j.subject_id
    LEFT JOIN topics t ON t.id = j.topic_id
    WHERE j.status IN ('failed', 'dead')
    ORDER BY j.processed_at DESC NULLS LAST, j.created_at DESC
    LIMIT 100
  `);

  res.json({ jobs: result.rows });
});

router.get('/dead', async (req, res) => {
  const result = await db.query(`
    SELECT
      j.id,
      j.exam_type,
      s.name AS subject_name,
      t.name AS topic_name,
      j.status,
      j.retry_count,
      j.last_error,
      j.created_at,
      j.processed_at
    FROM ai_highlight_jobs j
    LEFT JOIN subjects s ON s.id = j.subject_id
    LEFT JOIN topics t ON t.id = j.topic_id
    WHERE j.status = 'dead'
    ORDER BY j.processed_at DESC NULLS LAST
    LIMIT 100
  `);

  res.json({ jobs: result.rows });
});

router.get('/cost-stats', async (req, res) => {
  res.json(await getCostStats());
});

router.get('/cache-stats', async (req, res) => {
  const result = await db.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE cache_hit = true)::int AS cache_hits,
      COUNT(*) FILTER (WHERE cache_hit = false)::int AS ai_generated
    FROM ai_highlight_jobs
    WHERE processed_at >= NOW() - INTERVAL '24 hours'
  `);

  const row = result.rows[0];
  const rate = row.total ? Math.round((row.cache_hits / row.total) * 100) : 0;

  res.json({
    ...row,
    cache_hit_rate: rate,
  });
});

router.post('/push-pending', async (req, res) => {
  const result = await pushJobs({ limit: Number(req.body?.limit || 20) });
  res.json(result);
});

router.post('/retry-failed', async (req, res) => {
  const result = await db.query(`
    UPDATE ai_highlight_jobs
    SET status = 'pending',
        pushed_to_queue = false,
        retry_count = 0,
        last_error = NULL,
        locked_at = NULL,
        processed_at = NULL
    WHERE status IN ('failed', 'dead')
    RETURNING id
  `);

  res.json({ reset: result.rowCount });
});

router.post('/retry/:id', async (req, res) => {
  const result = await db.query(
    `
    UPDATE ai_highlight_jobs
    SET status = 'pending',
        pushed_to_queue = false,
        retry_count = 0,
        last_error = NULL,
        locked_at = NULL,
        processed_at = NULL
    WHERE id = $1
    RETURNING id
    `,
    [req.params.id]
  );

  res.json({ reset: result.rowCount });
});

router.post('/dead/:id', async (req, res) => {
  const result = await db.query(
    `
    UPDATE ai_highlight_jobs
    SET status = 'dead',
        pushed_to_queue = false,
        processed_at = NOW()
    WHERE id = $1
    RETURNING id
    `,
    [req.params.id]
  );

  res.json({ marked_dead: result.rowCount });
});

module.exports = router;
