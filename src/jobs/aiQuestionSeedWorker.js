'use strict';

const db = require('../db');
const { aiJSON } = require('../services/aiRouter');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const AI_SEED_BATCH_SIZE = Number(process.env.AI_SEED_BATCH_SIZE || 1);
const AI_MAX_QUESTIONS_PER_TOPIC = Number(process.env.AI_MAX_QUESTIONS_PER_TOPIC || 20);
const AI_SEED_INTERVAL_MS = Number(process.env.AI_SEED_INTERVAL_MS || 60000);
const AI_SEED_DELAY_MS = Number(process.env.AI_SEED_DELAY_MS || 15000);

function buildPrompt({ examType, subjectName, topicName, count }) {
  return `
Generate ${count} original ${examType.toUpperCase()} exam-style MCQ practice questions.

Subject: ${subjectName}
Topic: ${topicName}

Return valid JSON only.

Schema:
{
  "questions": [
    {
      "question_text": "...",
      "difficulty": 1,
      "explanation": "...",
      "options": [
        { "option_text": "...", "is_correct": true },
        { "option_text": "...", "is_correct": false },
        { "option_text": "...", "is_correct": false },
        { "option_text": "...", "is_correct": false }
      ]
    }
  ]
}

Rules:
- Exactly 4 options.
- Exactly 1 correct answer.
- Difficulty must be 1, 2, 3, 4, or 5.
- Do not copy real copyrighted past questions word-for-word.
- Make the questions realistic for ${examType.toUpperCase()}.
- Avoid repeating common/simple stems.
`;
}

async function topicQuestionCount(topicId) {
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM questions
    WHERE topic_id = $1
      AND is_active = true
    `,
    [topicId]
  );

  return Number(result.rows[0]?.count || 0);
}

async function insertQuestion(job, q) {
  if (!q || !q.question_text || !Array.isArray(q.options)) return null;
  if (q.options.length !== 4) return null;

  const correctCount = q.options.filter(o => !!o.is_correct).length;
  if (correctCount !== 1) return null;

  const stem = String(q.question_text).trim();
  if (!stem) return null;

  const exists = await db.query(
    `
    SELECT 1
    FROM questions
    WHERE topic_id = $1
      AND LOWER(TRIM(stem)) = LOWER(TRIM($2))
    LIMIT 1
    `,
    [job.topic_id, stem]
  );

  if (exists.rowCount > 0) return null;

  const questionResult = await db.query(
    `
    INSERT INTO questions (
      id,
      subject_id,
      topic_id,
      type,
      stem,
      explanation,
      difficulty,
      source_type,
      review_status,
      is_active,
      ai_generated,
      created_at
    )
    VALUES (
      gen_random_uuid(),
      $1,
      $2,
      'mcq',
      $3,
      $4,
      $5,
      'ai_generated',
      'approved',
      true,
      true,
      now()
    )
    ON CONFLICT (topic_id, stem) DO NOTHING
    RETURNING id
    `,
    [
      job.subject_id,
      job.topic_id,
      stem,
      q.explanation || '',
      Math.max(1, Math.min(5, Number(q.difficulty || 2)))
    ]
  );

  if (!questionResult.rows[0]) return null;

  const questionId = questionResult.rows[0].id;
  const labels = ['A', 'B', 'C', 'D'];

  for (let i = 0; i < q.options.length; i++) {
    const option = q.options[i];

    await db.query(
      `
      INSERT INTO question_options (
        id,
        question_id,
        label,
        text,
        is_correct,
        explanation,
        created_at
      )
      VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        $4,
        $5,
        now()
      )
      `,
      [
        questionId,
        labels[i],
        option.option_text || option.text || '',
        !!option.is_correct,
        option.explanation || null
      ]
    );
  }

  return questionId;
}

async function processSeedJobs() {
  const jobs = await db.query(
    `
    SELECT
      j.*,
      s.name AS subject_name,
      t.name AS topic_name
    FROM ai_seed_jobs j
    JOIN subjects s ON s.id = j.subject_id
    JOIN topics t ON t.id = j.topic_id
    WHERE j.status IN ('pending', 'failed')
      AND COALESCE(j.retry_count, 0) < 5
    ORDER BY j.created_at ASC
    LIMIT $1
    `,
    [AI_SEED_BATCH_SIZE]
  );

  if (!jobs.rowCount) return;

  for (const job of jobs.rows) {
    try {
      await db.query(
        `
        UPDATE ai_seed_jobs
        SET status = 'processing',
            processed_at = now()
        WHERE id = $1
        `,
        [job.id]
      );

      const currentCount = await topicQuestionCount(job.topic_id);

      if (currentCount >= AI_MAX_QUESTIONS_PER_TOPIC) {
        await db.query(
          `
          UPDATE ai_seed_jobs
          SET status = 'done',
              last_error = NULL,
              processed_at = now()
          WHERE id = $1
          `,
          [job.id]
        );

        console.log('[ai-seed] skipped, topic full:', job.subject_name, job.topic_name);
        continue;
      }

      const needed = Math.min(
        Number(job.target_count || 5),
        AI_MAX_QUESTIONS_PER_TOPIC - currentCount,
        5
      );

      const prompt = buildPrompt({
        examType: job.exam_type || 'general',
        subjectName: job.subject_name,
        topicName: job.topic_name,
        count: needed
      });

      const parsed = await aiJSON({
        feature: 'question_generation',
        task: 'bulk_question_generation',
        messages: [
          { role: 'system', content: 'Return valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.35,
        maxTokens: 1500
      });

      const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
      let inserted = 0;

      for (const q of questions) {
        const id = await insertQuestion(job, q);
        if (id) inserted += 1;
      }

      await db.query(
        `
        UPDATE ai_seed_jobs
        SET status = 'done',
            last_error = NULL,
            processed_at = now()
        WHERE id = $1
        `,
        [job.id]
      );

      console.log('[ai-seed] done:', {
        jobId: job.id,
        exam: job.exam_type,
        subject: job.subject_name,
        topic: job.topic_name,
        inserted
      });

      await sleep(AI_SEED_DELAY_MS);

    } catch (err) {
      const msg = err?.message || String(err);

      const isRateLimit =
        msg.includes('rate_limit') ||
        msg.includes('Rate limit') ||
        msg.includes('429');

      await db.query(
        `
        UPDATE ai_seed_jobs
        SET status = CASE
              WHEN COALESCE(retry_count, 0) + 1 >= 5 THEN 'dead'
              ELSE 'failed'
            END,
            retry_count = COALESCE(retry_count, 0) + 1,
            last_error = $2,
            processed_at = now()
        WHERE id = $1
        `,
        [job.id, msg]
      );

      console.error('[ai-seed] failed:', job.id, msg);

      if (isRateLimit) {
        console.log('[ai-seed] rate limited, cooling down...');
        await sleep(90000);
      } else {
        await sleep(AI_SEED_DELAY_MS);
      }
    }
  }
}

function startAIQuestionSeedWorker() {
  console.log('[ai-seed] worker started', {
    intervalMs: AI_SEED_INTERVAL_MS,
    delayMs: AI_SEED_DELAY_MS,
    batchSize: AI_SEED_BATCH_SIZE,
    maxPerTopic: AI_MAX_QUESTIONS_PER_TOPIC
  });

  setInterval(() => {
    processSeedJobs().catch(err => {
      console.error('[ai-seed] tick failed:', err.message);
    });
  }, AI_SEED_INTERVAL_MS);
}

module.exports = {
  startAIQuestionSeedWorker,
  processSeedJobs
};
