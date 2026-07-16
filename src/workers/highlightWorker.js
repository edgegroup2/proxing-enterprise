'use strict';

const { Worker } = require('bullmq');
const IORedis = require('ioredis');

const db = require('../db');
const { aiJSON } = require('../services/aiRouter');
const {
  buildCacheKey,
  getCached,
  setCache
} = require('../services/highlightCache');

const QUEUE_NAME = process.env.AI_HIGHLIGHT_QUEUE_NAME || 'highlight-jobs';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
};

const connection = new IORedis(REDIS_URL, redisOptions);

const CONCURRENCY = Number(process.env.AI_HIGHLIGHT_WORKER_CONCURRENCY || 1);
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.AI_HIGHLIGHT_RATE_LIMIT_COOLDOWN_MS || 180000);
const MIN_AI_CALL_GAP_MS = Number(process.env.AI_HIGHLIGHT_MIN_CALL_GAP_MS || 3000);
const MAX_RETRIES = Number(process.env.AI_HIGHLIGHT_MAX_RETRIES || 3);

let lastCallAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimit() {
  const now = Date.now();
  const diff = now - lastCallAt;

  if (diff < MIN_AI_CALL_GAP_MS) {
    await sleep(MIN_AI_CALL_GAP_MS - diff);
  }

  lastCallAt = Date.now();
}

function safeParseJSON(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;

  const text = String(value).trim();

  try {
    return JSON.parse(text);
  } catch (_) {
    try {
      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (!objectMatch) return null;
      return JSON.parse(objectMatch[0]);
    } catch (_) {
      return null;
    }
  }
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function normalizeHighlight(parsed, fallbackTitle) {
  return {
    title: parsed?.title || fallbackTitle || 'Study Highlights',
    summary: parsed?.summary || '',
    key_points: normalizeArray(parsed?.key_points),
    formulas: normalizeArray(parsed?.formulas),
    common_mistakes: normalizeArray(parsed?.common_mistakes),
    exam_tips: normalizeArray(parsed?.exam_tips)
  };
}

function isRateLimitError(err) {
  const msg = String(err?.message || err || '').toLowerCase();

  return (
    msg.includes('429') ||
    msg.includes('rate_limit') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  );
}

async function getPastQuestions(dbJob) {
  try {
    const res = await db.query(
      `
      SELECT question, options, answer, year
      FROM past_questions
      WHERE LOWER(exam_type) = LOWER($1)
        AND LOWER(subject) = LOWER($2)
        AND LOWER(topic) = LOWER($3)
      ORDER BY year DESC NULLS LAST
      LIMIT 3
      `,
      [dbJob.exam_type, dbJob.subject_name, dbJob.topic_name]
    );

    return res.rows || [];
  } catch (err) {
    console.warn('[highlight-worker] past_questions unavailable:', err.message);
    return [];
  }
}

function buildPrompt(dbJob, pastQuestions = []) {
  const exam = String(dbJob.exam_type || '').toUpperCase();

  const context =
    exam === 'JAMB'
      ? `
- Objective exam (CBT)
- Focus on speed and accuracy
- Include traps and shortcuts
- Emphasize likely MCQ patterns
- Highlight distractors and common tricks
`
      : `
- Theory + structured answers
- Focus on explanation and clarity
- Include step-by-step understanding
- Emphasize how to answer in exams
`;

  const examples = pastQuestions.length
    ? pastQuestions
        .map((p, index) => {
          return `
Example ${index + 1}${p.year ? ` (${p.year})` : ''}:
Question: ${p.question}
Options: ${JSON.stringify(p.options || [])}
Answer: ${p.answer || ''}
`;
        })
        .join('\n')
    : 'No verified past questions available for this topic yet.';

  return `
Generate study highlights tailored for ${exam}.

Subject: ${dbJob.subject_name}
Topic: ${dbJob.topic_name}

EXAM CONTEXT:
${context}

REAL EXAM REFERENCE:
${examples}

STRICT RULES:
- Output ONLY JSON
- No markdown
- No explanation outside JSON
- No trailing commas
- Use double quotes only
- Do not copy past questions word-for-word
- Use the examples only to understand exam style and difficulty

Format:
{
  "title": "string",
  "summary": "string",
  "key_points": ["point1", "point2", "point3"],
  "formulas": ["formula1"],
  "common_mistakes": ["mistake1", "mistake2"],
  "exam_tips": ["tip1", "tip2"]
}
`;
}

async function getHighlightJob(jobId) {
  const res = await db.query(
    `
    SELECT
      j.*,
      s.name AS subject_name,
      t.name AS topic_name
    FROM ai_highlight_jobs j
    JOIN subjects s ON s.id = j.subject_id
    JOIN topics t ON t.id = j.topic_id
    WHERE j.id = $1
    LIMIT 1
    `,
    [jobId]
  );

  return res.rows[0] || null;
}

async function markProcessing(jobId) {
  await db.query(
    `
    UPDATE ai_highlight_jobs
    SET status = 'processing',
        processed_at = now()
    WHERE id = $1
    `,
    [jobId]
  );
}

async function markDone(jobId) {
  await db.query(
    `
    UPDATE ai_highlight_jobs
    SET status = 'done',
        last_error = NULL,
        processed_at = now()
    WHERE id = $1
    `,
    [jobId]
  );
}

async function markFailed(jobId, message) {
  await db.query(
    `
    UPDATE ai_highlight_jobs
    SET status = CASE
          WHEN COALESCE(retry_count, 0) + 1 >= $3 THEN 'dead'
          ELSE 'failed'
        END,
        retry_count = COALESCE(retry_count, 0) + 1,
        pushed_to_queue = false,
        last_error = $2,
        processed_at = now()
    WHERE id = $1
    `,
    [jobId, String(message || 'unknown_error').slice(0, 1000), MAX_RETRIES]
  );
}

async function saveHighlight(dbJob, highlight) {
  await db.query(
    `
    INSERT INTO topic_highlights (
      exam_type,
      subject_id,
      topic_id,
      title,
      summary,
      key_points,
      formulas,
      common_mistakes,
      exam_tips,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    ON CONFLICT (exam_type, topic_id)
    DO UPDATE SET
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      key_points = EXCLUDED.key_points,
      formulas = EXCLUDED.formulas,
      common_mistakes = EXCLUDED.common_mistakes,
      exam_tips = EXCLUDED.exam_tips,
      updated_at = NOW()
    `,
    [
      dbJob.exam_type,
      dbJob.subject_id,
      dbJob.topic_id,
      highlight.title,
      highlight.summary,
      JSON.stringify(highlight.key_points || []),
      JSON.stringify(highlight.formulas || []),
      JSON.stringify(highlight.common_mistakes || []),
      JSON.stringify(highlight.exam_tips || [])
    ]
  );
}

async function generateHighlight(dbJob) {
  const pastQuestions = await getPastQuestions(dbJob);
const prompt = buildPrompt(dbJob, pastQuestions);

  await rateLimit();

  const raw = await aiJSON({
    feature: 'topic_highlights',
    task: 'highlight_generation',
    messages: [
      {
        role: 'system',
        content: 'Return ONLY strictly valid JSON. No markdown. No explanation.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.2,
    maxTokens: 900
  });

  const parsed = safeParseJSON(raw);

  if (!parsed) {
    throw new Error('invalid_json');
  }

  return normalizeHighlight(parsed, dbJob.topic_name);
}

async function getPastQuestions(dbJob) {
  try {
    const res = await db.query(
      `
      SELECT question, options, answer, year
      FROM past_questions
      WHERE LOWER(exam_type) = LOWER($1)
        AND LOWER(subject) = LOWER($2)
        AND (
          topic IS NULL
          OR LOWER(topic) = LOWER($3)
        )
      ORDER BY year DESC NULLS LAST, created_at DESC
      LIMIT 3
      `,
      [dbJob.exam_type, dbJob.subject_name, dbJob.topic_name]
    );

    return res.rows || [];
  } catch (err) {
    console.warn('[highlight-worker] past questions unavailable:', err.message);
    return [];
  }
}

async function processOne(jobId) {
  const dbJob = await getHighlightJob(jobId);

  if (!dbJob) {
    console.warn('[highlight-worker] missing job:', jobId);
    return;
  }

  await markProcessing(jobId);

  const cacheKey = buildCacheKey(dbJob);
  const cached = await getCached(cacheKey);

  if (cached) {
    const safe = normalizeHighlight(cached, dbJob.topic_name);

    await saveHighlight(dbJob, safe);
    await markDone(jobId);

    console.log('[highlight-worker] cache hit:', {
      jobId,
      cacheKey,
      exam: dbJob.exam_type,
      subject: dbJob.subject_name,
      topic: dbJob.topic_name
    });

    return;
  }

  try {
    const generated = await generateHighlight(dbJob);

    await saveHighlight(dbJob, generated);
    await setCache(cacheKey, generated);
    await markDone(jobId);

    console.log('[highlight-worker] generated:', {
      jobId,
      cacheKey,
      exam: dbJob.exam_type,
      subject: dbJob.subject_name,
      topic: dbJob.topic_name
    });
  } catch (err) {
    const msg = err?.message || String(err);

    await markFailed(jobId, msg);

    if (isRateLimitError(err)) {
      console.warn('[highlight-worker] rate limited — cooling down');
      await sleep(RATE_LIMIT_COOLDOWN_MS);
    } else {
      console.warn('[highlight-worker] failed:', {
        jobId,
        error: msg
      });
    }

    throw err;
  }
}

const worker = new Worker(
  QUEUE_NAME,
  async (bullJob) => {
    const jobId = bullJob.data?.jobId || bullJob.data?.id;

    if (!jobId) {
      console.warn('[highlight-worker] missing jobId:', bullJob.data);
      return;
    }

    await processOne(jobId);
  },
  {
    connection,
    concurrency: CONCURRENCY,
    limiter: {
      max: Number(process.env.AI_HIGHLIGHT_LIMIT_MAX || 1),
      duration: Number(process.env.AI_HIGHLIGHT_LIMIT_DURATION_MS || 3000)
    }
  }
);

worker.on('ready', () => {
  console.log('[highlight-worker] ready', {
    queue: QUEUE_NAME,
    concurrency: CONCURRENCY
  });
});

worker.on('completed', (job) => {
  console.log('[highlight-worker] completed:', job.id);
});

worker.on('failed', (job, err) => {
  console.error('[highlight-worker] failed:', {
    bullJobId: job?.id,
    error: err?.message
  });
});

async function shutdown(signal) {
  console.log('[highlight-worker] shutting down...', signal);
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

setInterval(() => {}, 1 << 30);
