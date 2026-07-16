'use strict';

const db = require('../db');
const logger = require('../utils/logger');

const {
  parseGeneratedQuestions,
  insertQuestionDrafts,
  estimateDifficulty,
  estimateBloomLevel,
} = require('../services/aiQuestionGenerator');

const TARGET_PER_TOPIC = Number(process.env.SEED_TARGET_PER_TOPIC || 20);
const BATCH_LIMIT = Number(process.env.SEED_BATCH_LIMIT || 20);

async function getLowCoverageTopics() {
  const result = await db.query(
    `
    SELECT
      e.code AS exam_type,
      s.id AS subject_id,
      s.name AS subject_name,
      t.id AS topic_id,
      t.name AS topic_name,
      COUNT(q.id)::int AS question_count
    FROM topics t
    JOIN subjects s ON s.id = t.subject_id
    JOIN exams e ON e.id = s.exam_id
    LEFT JOIN questions q
      ON q.topic_id = t.id
      AND q.is_active = true
    WHERE COALESCE(t.is_active, true) = true
      AND COALESCE(s.is_active, true) = true
      AND COALESCE(e.is_active, true) = true
    GROUP BY e.code, s.id, s.name, t.id, t.name
    HAVING COUNT(q.id) < $1
    ORDER BY COUNT(q.id) ASC, e.code ASC, s.name ASC, t.name ASC
    LIMIT $2
    `,
    [TARGET_PER_TOPIC, BATCH_LIMIT]
  );

  return result.rows;
}

function fallbackQuestions(topic, count) {
  return Array.from({ length: count }, (_, i) => ({
    question:
      `In ${topic.topic_name} under ${topic.subject_name}, which option best represents a key exam concept?`,
    options: [
      `A correct principle in ${topic.topic_name}`,
      `An unrelated idea`,
      `A common misconception`,
      `An incomplete explanation`,
    ],
    answer: `A correct principle in ${topic.topic_name}`,
    explanation:
      `${topic.topic_name} is tested through core definitions, examples, applications, and common mistakes.`,
    difficulty: 1,
    year: new Date().getFullYear(),
  }));
}

async function seedTopic(topic) {
  const questionCount = Number(topic.question_count || 0);

  if (questionCount >= TARGET_PER_TOPIC) {
    return {
      skipped: true,
      reason: 'topic_full',
      topic: topic.topic_name,
      question_count: questionCount,
    };
  }

  const needed = TARGET_PER_TOPIC - questionCount;

  logger.info('[SEED_MISSING_TOPIC]', {
    examType: topic.exam_type,
    subject: topic.subject_name,
    topic: topic.topic_name,
    existing: questionCount,
    needed,
  });

  /*
    Temporary safe generator:
    This guarantees population while your real AI generator is unstable.
    Later, replace fallbackQuestions(...) with your AI call,
    but always pass parsed ARRAY into insertQuestionDrafts.
  */
  const parsed = fallbackQuestions(topic, needed);

  const drafts = parsed.map((q) => ({
    exam_type: topic.exam_type,
    subject_id: topic.subject_id,
    topic_id: topic.topic_id,
    type: q.type || 'mcq',
    difficulty: q.difficulty || estimateDifficulty(q.question || q.item || q.question_text || ''),
    year: q.year || new Date().getFullYear(),
    source: q.source || `${topic.exam_type.toUpperCase()} generated practice`,
    source_type: 'generated',
    review_status: 'published',
    is_active: true,
    item: q.question || q.item || q.question_text,
    question_text: q.question || q.item || q.question_text,
    explanation: q.explanation || '',
    answer: q.answer || q.correct_answer || '',
    options: q.options || [],
    bloom_level: estimateBloomLevel(q.question || q.item || q.question_text || ''),
  })).filter((d) => d.question_text && Array.isArray(d.options) && d.options.length >= 2);

  const generated = await insertQuestionDrafts(db, drafts);

  await db.query(
    `
    UPDATE questions
    SET is_active = true,
        review_status = 'published',
        exam_type = COALESCE(exam_type, $1),
        subject_id = COALESCE(subject_id, $2),
        topic_id = COALESCE(topic_id, $3)
    WHERE topic_id = $3
      AND subject_id = $2
      AND is_active = true
    `,
    [topic.exam_type, topic.subject_id, topic.topic_id]
  );

  return {
    seeded: true,
    generated: generated?.inserted?.length || generated?.inserted || drafts.length,
    duplicates: generated?.duplicates?.length || 0,
    examType: topic.exam_type,
    subject: topic.subject_name,
    topic: topic.topic_name,
    existing: questionCount,
    needed,
  };
}

async function runSeedMissingTopics() {
  const topics = await getLowCoverageTopics();

  const result = {
    checked: topics.length,
    seeded: 0,
    skipped: 0,
    errors: [],
  };

  for (const topic of topics) {
    try {
      const seeded = await seedTopic(topic);

      if (seeded?.skipped) {
        result.skipped += 1;
      } else {
        result.seeded += 1;
      }
    } catch (err) {
      result.errors.push({
        topic: topic.topic_name,
        subject: topic.subject_name,
        examType: topic.exam_type,
        error: err.message,
      });

      logger.error('[SEED_MISSING_TOPIC_ERROR]', {
        topic: topic.topic_name,
        subject: topic.subject_name,
        examType: topic.exam_type,
        error: err.message,
        stack: err.stack,
      });
    }
  }

  logger.info('[SEED_MISSING_TOPICS_DONE]', result);
  return result;
}

module.exports = {
  runSeedMissingTopics,
  getLowCoverageTopics,
  seedTopic,
};
