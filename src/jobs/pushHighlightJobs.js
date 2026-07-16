'use strict';

const db = require('../db');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const QUEUE_NAME = process.env.AI_HIGHLIGHT_QUEUE_NAME || 'highlight-jobs';

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const queue = new Queue(QUEUE_NAME, { connection });

function getPriority(examType) {
  const exam = String(examType || '').toLowerCase();
  if (exam === 'waec') return 1;
  if (exam === 'jamb') return 2;
  if (exam === 'neco') return 3;
  return 5;
}

async function pushJobs({ limit = 20 } = {}) {
  try {
    const res = await db.query(
      `
      SELECT id, exam_type
      FROM ai_highlight_jobs
      WHERE status = 'pending'
        AND COALESCE(pushed_to_queue, false) = false
      ORDER BY
        CASE
          WHEN LOWER(exam_type) = 'waec' THEN 0
          WHEN LOWER(exam_type) = 'jamb' THEN 1
          WHEN LOWER(exam_type) = 'neco' THEN 2
          ELSE 3
        END,
        created_at ASC
      LIMIT $1
      `,
      [limit]
    );

    for (const row of res.rows) {
      await queue.add(
        'highlight',
        { jobId: row.id },
        {
          jobId: `highlight-${row.id}`,
          priority: getPriority(row.exam_type),
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 60000,
          },
          removeOnComplete: true,
          removeOnFail: 1000,
        }
      );

      await db.query(
        `
        UPDATE ai_highlight_jobs
        SET pushed_to_queue = true
        WHERE id = $1
        `,
        [row.id]
      );
    }

    if (res.rows.length) {
      console.log('[highlight-queue] pushed:', res.rows.length);
    }

    return { pushed: res.rows.length };
  } catch (err) {
    console.error('[pushHighlightJobs] error:', err.message);
    return { pushed: 0, error: err.message };
  }
}

module.exports = { pushJobs };
