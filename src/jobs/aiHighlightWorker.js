'use strict';

const db = require('../db');
const { aiJSON } = require('../services/aiRouter');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const INTERVAL_MS = Number(process.env.AI_HIGHLIGHT_INTERVAL_MS || 120000);
const DELAY_MS = Number(process.env.AI_HIGHLIGHT_DELAY_MS || 40000);
const BATCH_SIZE = Number(process.env.AI_HIGHLIGHT_BATCH_SIZE || 1);
const MAX_RETRIES = Number(process.env.AI_HIGHLIGHT_MAX_RETRIES || 3);

function safeParseJSON(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;

  const text = String(value).trim();

  try {
    return JSON.parse(text);
  } catch (_) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      return JSON.parse(match[0]);
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

function buildPrompt({ examType, subjectName, topicName }) {
  return `
Generate structured study highlights.

Exam: ${String(examType || '').toUpperCase()}
Subject: ${subjectName}
Topic: ${topicName}

STRICT RULES:
- Output ONLY JSON
- No markdown
- No explanation outside JSON
- No trailing commas
- Use double quotes only
- Keep content concise and exam-focused

Format:
{
  "title": "string",
  "summary": "string",
  "key_points": ["point1", "point2"],
  "formulas": ["formula1"],
  "common_mistakes": ["mistake1"],
  "exam_tips": ["tip1"]
}
`;
}

async function markJobFailed(jobId, errorMessage, maxRetries = MAX_RETRIES) {
  await db.query(
    `
    UPDATE ai_highlight_jobs
    SET status = CASE
          WHEN COALESCE(retry_count, 0) + 1 >= $3 THEN 'dead'
          ELSE 'failed'
        END,
        retry_count = COALESCE(retry_count, 0) + 1,
        last_error = $2,
        processed_at = now()
    WHERE id = $1
    `,
    [jobId, String(errorMessage || 'unknown_error').slice(0, 1000), maxRetries]
  );
}

async function processHighlightJobs() {
  const jobs = await db.query(
    `
    SELECT
      j.*,
      s.name AS subject_name,
      t.name AS topic_name
    FROM ai_highlight_jobs j
    JOIN subjects s ON s.id = j.subject_id
    JOIN topics t ON t.id = j.topic_id
    WHERE j.status IN ('pending', 'failed')
      AND COALESCE(j.retry_count, 0) < $2
    ORDER BY
      CASE
        WHEN LOWER(j.exam_type) IN ('waec', 'jamb') THEN 0
        WHEN LOWER(j.exam_type) = 'neco' THEN 1
        ELSE 2
      END,
      j.created_at ASC
    LIMIT $1
    `,
    [BATCH_SIZE, MAX_RETRIES]
  );

  for (const job of jobs.rows) {
    try {
      await db.query(
        `
        UPDATE ai_highlight_jobs
        SET status = 'processing',
            processed_at = now()
        WHERE id = $1
        `,
        [job.id]
      );

      const prompt = buildPrompt({
        examType: job.exam_type,
        subjectName: job.subject_name,
        topicName: job.topic_name
      });

      let raw;

      try {
        raw = await aiJSON({
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
      } catch (err) {
        const msg = err?.message || String(err);
        const isRateLimit =
          msg.includes('429') ||
          msg.toLowerCase().includes('rate_limit') ||
          msg.toLowerCase().includes('rate limit');

        await markJobFailed(job.id, isRateLimit ? msg : `ai_error: ${msg}`);

        if (isRateLimit) {
          console.warn('[ai-highlight] rate limited — cooling down');
          await sleep(180000);
        } else {
          console.warn('[ai-highlight] API error:', msg);
          await sleep(DELAY_MS);
        }

        continue;
      }

      const parsed = safeParseJSON(raw);

      if (!parsed) {
        await markJobFailed(job.id, 'invalid_json');

        console.warn('[ai-highlight] bad JSON, skipping:', {
          exam: job.exam_type,
          subject: job.subject_name,
          topic: job.topic_name
        });

        await sleep(DELAY_MS);
        continue;
      }

      const safe = {
        title: parsed.title || job.topic_name,
        summary: parsed.summary || '',
        key_points: normalizeArray(parsed.key_points),
        formulas: normalizeArray(parsed.formulas),
        common_mistakes: normalizeArray(parsed.common_mistakes),
        exam_tips: normalizeArray(parsed.exam_tips)
      };

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
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
        ON CONFLICT (exam_type, subject_id, topic_id, title)
        DO UPDATE SET
          summary = EXCLUDED.summary,
          key_points = EXCLUDED.key_points,
          formulas = EXCLUDED.formulas,
          common_mistakes = EXCLUDED.common_mistakes,
          exam_tips = EXCLUDED.exam_tips,
          updated_at = now()
        `,
        [
          job.exam_type,
          job.subject_id,
          job.topic_id,
          safe.title,
          safe.summary,
          JSON.stringify(safe.key_points),
          JSON.stringify(safe.formulas),
          JSON.stringify(safe.common_mistakes),
          JSON.stringify(safe.exam_tips)
        ]
      );

      await db.query(
        `
        UPDATE ai_highlight_jobs
        SET status = 'done',
            last_error = NULL,
            processed_at = now()
        WHERE id = $1
        `,
        [job.id]
      );

      console.log('[ai-highlight] done:', {
        exam: job.exam_type,
        subject: job.subject_name,
        topic: job.topic_name
      });

      await sleep(DELAY_MS);
    } catch (err) {
      const msg = err?.message || String(err);
      const isRateLimit =
        msg.includes('429') ||
        msg.toLowerCase().includes('rate_limit') ||
        msg.toLowerCase().includes('rate limit');

      await markJobFailed(job.id, msg);

      console.error('[ai-highlight] failed:', job.id, msg);

      if (isRateLimit) await sleep(180000);
      else await sleep(DELAY_MS);
    }
  }
}

function startAIHighlightWorker() {
  console.log('[ai-highlight] worker started', {
    intervalMs: INTERVAL_MS,
    delayMs: DELAY_MS,
    batchSize: BATCH_SIZE,
    maxRetries: MAX_RETRIES
  });

  processHighlightJobs().catch((err) => {
    console.error('[ai-highlight] initial run failed:', err.message);
  });

module.exports = {
  startAIHighlightWorker,
  processHighlightJobs
};
