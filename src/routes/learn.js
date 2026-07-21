'use strict';
const {
  SUPPORTED_STUDY_ROOM_EXAM_TYPES,
  normalizeStudyRoomExamType,
  isSupportedStudyRoomExamType,
  isStudyRoomExamTypeConstraintViolation,
} = require('../constants/examCatalogue');

const express = require('express');
const learnLiveStudyRouter = require('./learnLiveStudy');

const router = express.Router();
router.use(learnLiveStudyRouter);
const { aiJSON } = require('../services/aiRouter');
const db = require('../db');
const { recordAttempt } = require('../services/studentAttemptService');
const { getOrCreateExplanation } = require('../services/aiExplanationService');
const {
  chooseDifficulty,
  getTopicMastery,
  updateTopicMastery,
  buildAIFeedback
} = require('../services/learning/adaptiveEngine');
const authModule = require('../middleware/auth');

const requireAuth =
  authModule.requireAuth ||
  authModule.authMiddleware ||
  authModule.userAuth ||
  authModule.default ||
  authModule;

if (typeof requireAuth !== 'function') {
  throw new Error(
    `learn auth middleware is not a function. Exported keys: ${Object.keys(authModule || {}).join(', ')}`
  );
}

function makeInviteCode(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function generateUniqueInviteCode() {
  for (let i = 0; i < 12; i += 1) {
    const code = makeInviteCode(6);
    const existing = await db.query(
      'SELECT id FROM study_rooms WHERE invite_code = $1 LIMIT 1',
      [code]
    );
    if (!existing.rows.length) return code;
  }
  throw new Error('Failed to generate unique invite code');
}

async function getRoomById(roomId) {
  const result = await db.query(
    `
    SELECT
      r.*,
      s.name AS subject_name
    FROM study_rooms r
    LEFT JOIN subjects s ON s.id = r.subject_id
    WHERE r.id = $1
    LIMIT 1
    `,
    [roomId]
  );
  return result.rows[0] || null;
}

async function userIsRoomMember(roomId, userId) {
  const result = await db.query(
    `
    SELECT id
    FROM study_room_members
    WHERE room_id = $1 AND user_id = $2
    LIMIT 1
    `,
    [roomId, String(userId)]
  );
  return !!result.rows.length;
}

async function getRoomMembers(roomId) {
  const result = await db.query(
    `
    SELECT
      id,
      room_id,
      user_id,
      role,
      joined_at,
      last_seen_at,
      score,
      is_online
    FROM study_room_members
    WHERE room_id = $1
    ORDER BY
      CASE WHEN role = 'host' THEN 0 ELSE 1 END,
      joined_at ASC
    `,
    [roomId]
  );
  return result.rows;
}

async function getRoomMessages(roomId) {
  const result = await db.query(
    `
    SELECT
      id,
      room_id,
      user_id,
      sender_type,
      message,
      meta,
      created_at
    FROM study_room_messages
    WHERE room_id = $1
    ORDER BY created_at ASC
    LIMIT 100
    `,
    [roomId]
  );
  return result.rows;
}

async function rebuildTopicCoverage(topicId) {
  const result = await db.query(`
    SELECT
      COUNT(*)::int AS total_questions,
      COUNT(*) FILTER (WHERE difficulty <= 1)::int AS easy_count,
      COUNT(*) FILTER (WHERE difficulty BETWEEN 2 AND 3)::int AS medium_count,
      COUNT(*) FILTER (WHERE difficulty >= 4)::int AS hard_count
    FROM questions
    WHERE topic_id = $1
      AND COALESCE(is_active, true) = true
      AND COALESCE(review_status, 'approved') = 'approved'
  `, [topicId]);

  const row = result.rows[0];

  const total = Number(row.total_questions || 0);
  const easy = Number(row.easy_count || 0);
  const medium = Number(row.medium_count || 0);
  const hard = Number(row.hard_count || 0);

  const hasDifficultySpread =
    [easy > 0, medium > 0, hard > 0].filter(Boolean).length >= 2;

  const coverageScore = Math.min(total / 50, 1);
  const isReady = total >= 20 && hasDifficultySpread;

  await db.query(`
    INSERT INTO topic_coverage (
      topic_id,
      total_questions,
      easy_count,
      medium_count,
      hard_count,
      coverage_score,
      is_ready,
      last_updated
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,now())
    ON CONFLICT (topic_id)
    DO UPDATE SET
      total_questions = EXCLUDED.total_questions,
      easy_count = EXCLUDED.easy_count,
      medium_count = EXCLUDED.medium_count,
      hard_count = EXCLUDED.hard_count,
      coverage_score = EXCLUDED.coverage_score,
      is_ready = EXCLUDED.is_ready,
      last_updated = now()
  `, [
    topicId,
    total,
    easy,
    medium,
    hard,
    coverageScore,
    isReady
  ]);

  return { total, easy, medium, hard, coverageScore, isReady };
}

async function getCurrentQuestion(questionId) {
  if (!questionId) return null;

  const questionResult = await db.query(
    `
    SELECT
      q.id,
      q.topic_id,
      q.type,
      q.stem,
      q.difficulty,
      q.year,
      q.source,
      q.explanation
    FROM questions q
    WHERE q.id = $1
    LIMIT 1
    `,
    [questionId]
  );

  if (!questionResult.rows.length) return null;

  const question = questionResult.rows[0];

  const optionsResult = await db.query(
    `
    SELECT
      id,
      question_id,
      label,
      text
    FROM question_options
    WHERE question_id = $1
    ORDER BY label ASC
    `,
    [question.id]
  );

  return {
    ...question,
    options: optionsResult.rows
  };
}

function examName(code) {
  const map = {
    jamb: 'JAMB',
    waec: 'WAEC',
    neco: 'NECO',
    ielts: 'IELTS',
    sat: 'SAT',
    gre: 'GRE'
  };

  return map[String(code || '').toLowerCase()] || String(code || '').toUpperCase();
}

function makeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * NEW STRUCTURE:
 * GET /api/learn/exams
 */
router.get('/exams', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        s.exam_type,
        COUNT(DISTINCT s.id)::int AS subject_count,
        COUNT(DISTINCT t.id)::int AS topic_count,
        COUNT(DISTINCT q.id)::int AS question_count
      FROM subjects s
      LEFT JOIN topics t ON t.subject_id = s.id
      LEFT JOIN questions q ON q.topic_id = t.id
      WHERE COALESCE(s.is_active, true) = true
      GROUP BY s.exam_type
      ORDER BY s.exam_type ASC
    `);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        code: row.exam_type,
        exam_type: row.exam_type,
        name: examName(row.exam_type),
        subject_count: row.subject_count,
        topic_count: row.topic_count,
        question_count: row.question_count
      }))
    });
  } catch (err) {
    console.error('[LEARN_EXAMS_ERROR]', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/learn/exams/:examType/subjects
 */
router.get('/exams/:examType/subjects', async (req, res) => {
  try {
    const examType = String(req.params.examType || '').toLowerCase();

const result = await db.query(
  `
  WITH adaptive AS (
    SELECT
      s.id,
      COUNT(DISTINCT t.id)::int AS topic_count,
      COUNT(DISTINCT q.id)::int AS question_count
    FROM subjects s
    LEFT JOIN topics t
      ON t.subject_id = s.id
     AND COALESCE(t.is_active, true) = true
    LEFT JOIN questions q
      ON q.topic_id = t.id
     AND COALESCE(q.is_active, true) = true
    WHERE LOWER(s.exam_type) = $1
      AND COALESCE(s.is_active, true) = true
    GROUP BY s.id
  ),
  premium AS (
    SELECT
      LOWER(TRIM(subject)) AS subject_key,
      LOWER(TRIM(exam_type)) AS exam_key,
      COUNT(*)::int AS premium_question_count,
      COUNT(DISTINCT LOWER(TRIM(topic)))::int AS premium_topic_count
    FROM past_questions
    WHERE LOWER(TRIM(exam_type)) = $1
    GROUP BY LOWER(TRIM(subject)), LOWER(TRIM(exam_type))
  )
  SELECT
    s.id,
    s.code,
    s.name,
    s.exam_type,
    COALESCE(
      s.slug,
      LOWER(REGEXP_REPLACE(s.name, '[^a-zA-Z0-9]+', '-', 'g'))
    ) AS slug,
    COALESCE(a.topic_count, 0) AS topic_count,
    COALESCE(a.question_count, 0) AS question_count,
    COALESCE(p.premium_question_count, 0) AS premium_question_count,
    COALESCE(p.premium_topic_count, 0) AS premium_topic_count
  FROM subjects s
  LEFT JOIN adaptive a ON a.id = s.id
  LEFT JOIN premium p
    ON p.subject_key = LOWER(TRIM(s.name))
   AND p.exam_key = LOWER(TRIM(s.exam_type))
  WHERE LOWER(s.exam_type) = $1
    AND COALESCE(s.is_active, true) = true
  ORDER BY s.name ASC
  `,
  [examType]
);

    res.json({
      success: true,
      exam: {
        code: examType,
        name: examName(examType)
      },
      data: result.rows
    });
  } catch (err) {
    console.error('[LEARN_EXAM_SUBJECTS_ERROR]', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// GET /api/learn/exams/:examType/subjects/:subjectId/premium-topics
router.get('/exams/:examType/subjects/:subjectId/premium-topics', requireAuth, async (req, res) => {
  try {
    const examType = String(req.params.examType || '').toLowerCase();
    const subjectId = req.params.subjectId;

    const subjectResult = await db.query(
      `
      SELECT id, name, exam_type
      FROM subjects
      WHERE id = $1::uuid
        AND LOWER(exam_type) = LOWER($2)
      LIMIT 1
      `,
      [subjectId, examType]
    );

    if (!subjectResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    const subjectName = subjectResult.rows[0].name;

    const topicsResult = await db.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(topic), ''), 'Uncategorized') AS name,
        COUNT(*)::int AS past_question_count,
        DENSE_RANK() OVER (
          ORDER BY COUNT(*) DESC
        )::int AS frequency_rank
      FROM past_questions
      WHERE LOWER(TRIM(exam_type)) = LOWER($1)
        AND LOWER(TRIM(subject)) = LOWER(TRIM($2))
      GROUP BY COALESCE(NULLIF(TRIM(topic), ''), 'Uncategorized')
      ORDER BY past_question_count DESC, name ASC
      `,
      [examType, subjectName]
    );

    const topics = topicsResult.rows.map((topic) => ({
      id: makeSlug(topic.name),
      name: topic.name,
      past_question_count: Number(topic.past_question_count || 0),
      frequency_rank: Number(topic.frequency_rank || 0),
      yield_band:
        Number(topic.past_question_count || 0) >= 30
          ? 'high'
          : Number(topic.past_question_count || 0) >= 10
            ? 'medium'
            : 'low'
    }));

    return res.json({
      success: true,
      data: {
        subject: subjectResult.rows[0],
        summary: {
          premium_question_count: topics.reduce(
            (sum, t) => sum + t.past_question_count,
            0
          ),
          premium_topic_count: topics.length
        },
        topics
      }
    });
  } catch (err) {
    console.error('[PREMIUM_TOPICS_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/learn/exams/:examType/subjects/:subjectId/topics
 *
 * subjectId can be UUID or slug.
 */
router.get('/exams/:examType/subjects/:subjectId/topics', async (req, res) => {
  try {
    const { examType, subjectId } = req.params;

    console.log('[LEARN_TOPICS_ROUTE_HIT]', { examType, subjectId });

const result = await db.query(`
  SELECT
    t.id,
    t.subject_id,
    t.name,
    LOWER(REGEXP_REPLACE(t.name, '[^a-zA-Z0-9]+', '-', 'g')) AS slug,
    0 AS sort_order,
    COUNT(q.id)::int AS question_count,
    0 AS highlight_count,
    0 AS coverage_score,
    true AS is_ready
  FROM topics t
  JOIN questions q
    ON q.topic_id = t.id
    AND COALESCE(q.is_active, true) = true
  WHERE t.subject_id::text = $1::text
    AND LOWER($2) = LOWER($2)
  GROUP BY t.id, t.subject_id, t.name
  HAVING COUNT(q.id) > 0
  ORDER BY question_count DESC, t.name ASC
`, [subjectId, examType]);

    console.log('[LEARN_TOPICS_RESULT]', {
      subjectId,
      examType,
      count: result.rows.length,
      names: result.rows.map(r => r.name)
    });

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('[LEARN_TOPICS_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch topics'
    });
  }
});

/**
 * Premium JAMB past-question topic map
 * GET /api/learn/exams/:examType/subjects/:subjectId/premium-topics
 */
router.get('/exams/:examType/subjects/:subjectId/premium-topics', requireAuth, async (req, res) => {
  try {
    const examType = String(req.params.examType || '').toLowerCase();
    const subjectId = req.params.subjectId;

    const subjectResult = await db.query(
      `
      SELECT id, name, exam_type
      FROM subjects
      WHERE id = $1::uuid
        AND LOWER(exam_type) = LOWER($2)
      LIMIT 1
      `,
      [subjectId, examType]
    );

    if (!subjectResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    const topicsResult = await db.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(topic), ''), 'Uncategorized') AS name,
        COUNT(*)::int AS past_question_count,
        DENSE_RANK() OVER (
          ORDER BY COUNT(*) DESC
        )::int AS frequency_rank
      FROM past_questions
      WHERE LOWER(TRIM(exam_type)) = LOWER($1)
        AND LOWER(TRIM(subject)) = LOWER(TRIM($2))
      GROUP BY COALESCE(NULLIF(TRIM(topic), ''), 'Uncategorized')
      ORDER BY past_question_count DESC, name ASC
      `,
      [examType, subjectResult.rows[0].name]
    );

    const topics = topicsResult.rows.map((topic) => ({
      id: makeSlug(topic.name),
      name: topic.name,
      past_question_count: Number(topic.past_question_count || 0),
      frequency_rank: Number(topic.frequency_rank || 0),
      yield_band:
        Number(topic.past_question_count || 0) >= 30
          ? 'high'
          : Number(topic.past_question_count || 0) >= 10
            ? 'medium'
            : 'low'
    }));

    return res.json({
      success: true,
      data: {
        subject: subjectResult.rows[0],
        summary: {
          premium_question_count: topics.reduce((sum, t) => sum + t.past_question_count, 0),
          premium_topic_count: topics.length
        },
        topics
      }
    });
  } catch (err) {
    console.error('[PREMIUM_TOPICS_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch premium topics'
    });
  }
});

/**
 * Adaptive learning map
 * GET /api/learn/exams/:examType/subjects/:subjectId/adaptive-map
 */
router.get('/exams/:examType/subjects/:subjectId/adaptive-map', requireAuth, async (req, res) => {
  try {
    const examType = String(req.params.examType || '').toLowerCase();
    const subjectId = req.params.subjectId;
    const userId = req.user?.id;

    const subjectResult = await db.query(
      `
      SELECT id, name, exam_type
      FROM subjects
      WHERE id = $1::uuid
        AND LOWER(exam_type) = LOWER($2)
      LIMIT 1
      `,
      [subjectId, examType]
    );

    if (!subjectResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    const topicsResult = await db.query(
      `
      SELECT
        t.id,
        t.name,
        COUNT(DISTINCT q.id)::int AS question_count,
        COALESCE(SUM(CASE WHEN a.is_correct = true THEN 1 ELSE 0 END), 0)::int AS correct,
        COALESCE(COUNT(a.id), 0)::int AS attempts,
        COALESCE(AVG(a.response_time), 0)::numeric(10,2) AS avg_time
      FROM topics t
      LEFT JOIN questions q
        ON q.topic_id = t.id
       AND COALESCE(q.is_active, true) = true
      LEFT JOIN student_question_attempts a
        ON a.topic_id = t.id
       AND a.user_id = $1
      WHERE t.subject_id = $2::uuid
        AND COALESCE(t.is_active, true) = true
      GROUP BY t.id, t.name
      ORDER BY t.name ASC
      `,
      [userId, subjectId]
    );

    const topics = topicsResult.rows.map((row) => {
      const attempts = Number(row.attempts || 0);
      const correct = Number(row.correct || 0);
      const mastery = attempts > 0 ? Math.round((correct / attempts) * 100) : 0;

      const status =
        mastery < 40 ? 'weak' :
        mastery < 75 ? 'improving' :
        'strong';

      const priority_score =
        status === 'weak'
          ? 100 - mastery + Number(row.question_count || 0)
          : 100 - mastery;

      return {
        id: row.id,
        name: row.name,
        question_count: Number(row.question_count || 0),
        mastery,
        status,
        recommended: status === 'weak',
        mistake_count: attempts - correct,
        speed_score: Number(row.avg_time || 0),
        accuracy_score: mastery,
        priority_score
      };
    });

    const weak = topics.filter(t => t.status === 'weak').length;
    const improving = topics.filter(t => t.status === 'improving').length;
    const strong = topics.filter(t => t.status === 'strong').length;
    const averageMastery = topics.length
      ? Math.round(topics.reduce((sum, t) => sum + t.mastery, 0) / topics.length)
      : 0;

    return res.json({
      success: true,
      data: {
        subject: subjectResult.rows[0],
        summary: {
          total_topics: topics.length,
          weak_topics: weak,
          improving_topics: improving,
          strong_topics: strong,
          average_mastery: averageMastery
        },
        topics: topics.sort((a, b) => b.priority_score - a.priority_score)
      }
    });
  } catch (err) {
    console.error('[ADAPTIVE_MAP_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch adaptive map'
    });
  }
});

/**
 * GET /api/learn/topics/:topicId/detail
 */
router.get('/topics/:topicId/detail', async (req, res) => {
  try {
    const topicId = String(req.params.topicId);

    const topicResult = await db.query(
      `
      SELECT
        t.id,
        t.name,
        COALESCE(t.slug, LOWER(REGEXP_REPLACE(t.name, '[^a-zA-Z0-9]+', '-', 'g'))) AS slug,
        t.subject_id,
        s.name AS subject_name,
        s.exam_type
      FROM topics t
      JOIN subjects s ON s.id = t.subject_id
      WHERE t.id = $1
      LIMIT 1
      `,
      [topicId]
    );

    if (!topicResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Topic not found'
      });
    }

const highlightsResult = await db.query(
  `
  SELECT
    id,
    title,
    COALESCE(summary, title, '') AS body,
    'highlight' AS type,
    0 AS sort_order
  FROM topic_highlights
  WHERE topic_id = $1
  ORDER BY created_at ASC
  `,
  [topicId]
);

    const questionsResult = await db.query(
      `
SELECT
  q.id,
  COALESCE(q.stem, q.question) AS question_text,
  q.stem,
  q.type,
  q.difficulty,
  q.year,
  q.source,
  q.explanation,
        COALESCE(
          json_agg(
            json_build_object(
              'label', qo.label,
              'text', qo.text,
              'is_correct', qo.is_correct
            )
            ORDER BY qo.label
          ) FILTER (WHERE qo.id IS NOT NULL),
          '[]'
        ) AS options
      FROM questions q
      LEFT JOIN question_options qo ON qo.question_id = q.id
      WHERE q.topic_id = $1
        AND COALESCE(q.is_active, true) = true
      GROUP BY q.id
      ORDER BY q.difficulty ASC, q.created_at DESC
      LIMIT 20
      `,
      [topicId]
    );

    res.json({
      success: true,
      data: {
        topic: topicResult.rows[0],
        highlights: highlightsResult.rows,
        questions: questionsResult.rows
      }
    });
  } catch (err) {
    console.error('[LEARN_TOPIC_DETAIL_ERROR]', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

async function getNextAdaptiveQuestion({ userId, topicId, sessionId, targetDifficulty }) {
const weakSkillResult = await db.query(`
  SELECT skill_tag
  FROM student_skill_mastery
  WHERE user_id = $1
    AND topic_id = $2
  ORDER BY mastery_score ASC, updated_at DESC
  LIMIT 1
`, [userId, topicId]);

const weakSkillTag = weakSkillResult.rows[0]?.skill_tag || null;

if (weakSkillTag) {
  const weakSkillQuestionResult = await db.query(`
    SELECT q.*
    FROM questions q
    WHERE q.topic_id = $1
      AND q.skill_tag = $2
      AND COALESCE(q.is_active, true) = true
      AND q.id NOT IN (
        SELECT ssa.question_id
        FROM study_session_answers ssa
        WHERE ssa.session_id = $3
      )
    ORDER BY
      CASE WHEN q.difficulty = $4 THEN 0 ELSE 1 END,
      RANDOM()
    LIMIT 1
  `, [topicId, weakSkillTag, sessionId, targetDifficulty]);

  if (weakSkillQuestionResult.rows.length) {
    return {
      question: weakSkillQuestionResult.rows[0],
      strategy: 'weak_skill_focus',
      weakSkillTag
    };
  }
}

  // 1) Retry wrong answers from this session first
  const retryWrongResult = await db.query(`
    SELECT q.*
    FROM questions q
    WHERE q.topic_id = $1
      AND COALESCE(q.is_active, true) = true
      AND q.id IN (
        SELECT ssa.question_id
        FROM study_session_answers ssa
        WHERE ssa.session_id = $2
          AND ssa.is_correct = false
      )
    ORDER BY
      CASE WHEN q.difficulty = $3 THEN 0 ELSE 1 END,
      RANDOM()
    LIMIT 1
  `, [topicId, sessionId, targetDifficulty]);

  if (retryWrongResult.rows.length) {
    return {
      question: retryWrongResult.rows[0],
      strategy: 'retry_wrong'
    };
  }

  // 2) Unseen questions in preferred difficulty band
  const unseenPreferredResult = await db.query(`
    SELECT q.*
    FROM questions q
    WHERE q.topic_id = $1
      AND COALESCE(q.is_active, true) = true
      AND q.difficulty BETWEEN GREATEST(1, $3 - 1) AND LEAST(5, $3 + 1)
      AND q.id NOT IN (
        SELECT ssa.question_id
        FROM study_session_answers ssa
        WHERE ssa.session_id = $2
      )
    ORDER BY
      CASE WHEN q.difficulty = $3 THEN 0 ELSE 1 END,
      RANDOM()
    LIMIT 1
  `, [topicId, sessionId, targetDifficulty]);

  if (unseenPreferredResult.rows.length) {
    return {
      question: unseenPreferredResult.rows[0],
      strategy: 'unseen_preferred'
    };
  }

  // 3) Any unseen question in topic
  const unseenAnyDifficultyResult = await db.query(`
    SELECT q.*
    FROM questions q
    WHERE q.topic_id = $1
      AND COALESCE(q.is_active, true) = true
      AND q.id NOT IN (
        SELECT ssa.question_id
        FROM study_session_answers ssa
        WHERE ssa.session_id = $2
      )
    ORDER BY RANDOM()
    LIMIT 1
  `, [topicId, sessionId]);

  if (unseenAnyDifficultyResult.rows.length) {
    return {
      question: unseenAnyDifficultyResult.rows[0],
      strategy: 'unseen_any_difficulty'
    };
  }

  // 4) Fallback repeat if topic is exhausted
  const repeatAnyResult = await db.query(`
    SELECT q.*
    FROM questions q
    WHERE q.topic_id = $1
      AND COALESCE(q.is_active, true) = true
    ORDER BY
      CASE WHEN q.difficulty = $2 THEN 0 ELSE 1 END,
      RANDOM()
    LIMIT 1
  `, [topicId, targetDifficulty]);

  if (repeatAnyResult.rows.length) {
    return {
      question: repeatAnyResult.rows[0],
      strategy: 'repeat_any'
    };
  }

  return {
    question: null,
    strategy: 'none'
  };
}

/**
 * GET /api/learn/health
 */
router.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    return res.json({ ok: true, feature: 'learn' });
  } catch (err) {
    console.error('LEARN_HEALTH_ERROR', err);
    return res.status(500).json({ ok: false, error: 'DB check failed' });
  }
});

/**
 * GET /api/learn/subjects?exam_type=jamb
 */
router.get('/subjects', async (req, res) => {
  try {
    const { exam_type } = req.query;

    let sql = `
      SELECT id, code, name, exam_type, created_at
      FROM subjects
    `;
    const params = [];

    if (exam_type) {
      params.push(String(exam_type).toLowerCase());
      sql += ` WHERE exam_type = $${params.length}`;
    }

    sql += ' ORDER BY name ASC';

    const result = await db.query(sql, params);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('LEARN_SUBJECTS_ERROR', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch subjects'
    });
  }
});

router.get('/review', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { exam_type, subject_id, topic_id } = req.query;

    const result = await db.query(`
      SELECT *
      FROM student_question_attempts
      WHERE user_id = $1
        AND is_correct = false
        AND ($2::text IS NULL OR LOWER(exam_type) = LOWER($2))
        AND ($3::uuid IS NULL OR subject_id = $3::uuid)
        AND ($4::uuid IS NULL OR topic_id = $4::uuid)
      ORDER BY created_at DESC
      LIMIT 100
    `, [userId, exam_type || null, subject_id || null, topic_id || null]);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[LEARN_REVIEW_ERROR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/learn/rooms
 */
router.get('/rooms', async (req, res) => {
  try {
    const { exam_type, subject_id, status } = req.query;

    const where = ['r.is_public = true'];
    const params = [];

    if (exam_type) {
      params.push(String(exam_type).toLowerCase());
      where.push(`r.exam_type = $${params.length}`);
    }

    if (subject_id) {
      params.push(subject_id);
      where.push(`r.subject_id = $${params.length}`);
    }

    if (status) {
      params.push(String(status).toLowerCase());
      where.push(`r.status = $${params.length}`);
    }

    const result = await db.query(
      `
      SELECT
        r.id,
        r.name,
        r.subject_id,
        s.name AS subject_name,
        r.exam_type,
        r.mode,
        r.status,
        r.max_members,
        r.is_public,
        r.invite_code,
        r.host_user_id,
        r.created_at,
        COUNT(m.id)::int AS member_count
      FROM study_rooms r
      LEFT JOIN subjects s ON s.id = r.subject_id
      LEFT JOIN study_room_members m ON m.room_id = r.id
      WHERE ${where.join(' AND ')}
      GROUP BY r.id, s.name
      ORDER BY r.created_at DESC
      LIMIT 50
      `,
      params
    );

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('LEARN_LIST_ROOMS_ERROR', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to list rooms'
    });
  }
});

/**
 * POST /api/learn/rooms/create
 */
function sendInvalidStudyRoomExamType(
  res
) {
  return res.status(400).json({
    success: false,
    code: 'INVALID_EXAM_TYPE',
    error:
      'exam_type must be one of the supported exam types',
    allowed_exam_types:
      SUPPORTED_STUDY_ROOM_EXAM_TYPES,
  });
}

router.post('/rooms/create', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);

    const {
      name,
      subject_id = null,
      exam_type,
      mode = 'coop',
      max_members = 10,
      is_public = true
    } = req.body;

    const normalizedName =
      name === null ||
      name === undefined
        ? ''
        : String(name).trim();

    const normalizedExamType =
      normalizeStudyRoomExamType(
        exam_type
      );

    if (!normalizedName) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'name is required'
      });
    }

    if (
      !isSupportedStudyRoomExamType(
        normalizedExamType
      )
    ) {
      return sendInvalidStudyRoomExamType(
        res
      );
    }

    const inviteCode =
      await generateUniqueInviteCode();

    const roomResult = await db.query(
      `
      INSERT INTO study_rooms
      (
        name,
        subject_id,
        exam_type,
        mode,
        host_user_id,
        max_members,
        is_public,
        invite_code
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        normalizedName,
        subject_id,
        normalizedExamType,
        String(mode).toLowerCase(),
        userId,
        Number(max_members) || 10,
        Boolean(is_public),
        inviteCode
      ]
    );

    const room = roomResult.rows[0];

    await db.query(
      `
      INSERT INTO study_room_members (room_id, user_id, role, is_online, last_seen_at)
      VALUES ($1,$2,'host',true,now())
      ON CONFLICT (room_id, user_id) DO NOTHING
      `,
      [room.id, userId]
    );

    return res.status(201).json({
      success: true,
      data: room
    });
  } catch (err) {
    if (
      isStudyRoomExamTypeConstraintViolation(
        err
      )
    ) {
      return sendInvalidStudyRoomExamType(
        res
      );
    }

    console.error(
      'LEARN_CREATE_ROOM_ERROR',
      err
    );

    return res.status(500).json({
      success: false,
      error: 'Failed to create room'
    });
  }
});

router.get('/rooms/:roomId/feed', requireAuth, async (req, res) => {
  try {
    const roomId = String(req.params.roomId);

    const result = await db.query(`
      SELECT
        rse.id,
        rse.room_id,
        rse.user_id,
        rse.event_type,
        rse.payload,
        rse.created_at
      FROM room_study_events rse
      WHERE rse.room_id = $1
      ORDER BY rse.created_at DESC
      LIMIT 100
    `, [roomId]);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('ROOM_FEED_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/questions/:questionId/explanation', requireAuth, async (req, res) => {
  try {
    const questionId = String(req.params.questionId || '').trim();

    if (!questionId || questionId === 'undefined' || questionId === 'null') {
      return res.status(400).json({
        success: false,
        error: 'Valid questionId is required',
        explanation: null
      });
    }

    const result = await getOrCreateExplanation(questionId);

    return res.json({
      success: true,
      cached: result.cached,
      data: result.explanation
    });
  } catch (err) {
    console.error('QUESTION_EXPLANATION_ERROR:', err.message);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/admin/question-drafts/:draftId/approve-publish', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const draftId = String(req.params.draftId);

    const draftResult = await db.query(`
      SELECT *
      FROM question_drafts
      WHERE id = $1
      LIMIT 1
    `, [draftId]);

    if (!draftResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Draft not found'
      });
    }

    const draft = draftResult.rows[0];

    if (!draft.topic_id) {
      return res.status(400).json({
        success: false,
        error: 'Draft has no topic_id'
      });
    }

    if (!draft.stem && !draft.question) {
      return res.status(400).json({
        success: false,
        error: 'Draft has no question text'
      });
    }

    const questionText = draft.stem || draft.question;

    const questionResult = await db.query(`
      INSERT INTO questions (
        topic_id,
        subject_id,
        type,
        stem,
        difficulty,
        year,
        source,
        explanation,
        skill_tag,
        is_active,
        review_status,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,'approved',now())
      RETURNING *
    `, [
      draft.topic_id,
      draft.subject_id || null,
      draft.type || 'mcq',
      questionText,
      draft.difficulty || 2,
      draft.year || null,
      draft.source || 'ingestion',
      draft.explanation || null,
      draft.skill_tag || null
    ]);

    const question = questionResult.rows[0];

    const options = draft.options || draft.option_json || [];

    if (Array.isArray(options) && options.length) {
      for (const option of options) {
        await db.query(`
          INSERT INTO question_options (
            question_id,
            label,
            text,
            is_correct,
            explanation
          )
          VALUES ($1,$2,$3,$4,$5)
        `, [
          question.id,
          option.label || null,
          option.text || option.value || '',
          !!option.is_correct,
          option.explanation || null
        ]);
      }
    }

    await db.query(`
      UPDATE question_drafts
      SET
        review_status = 'approved',
        publish_status = 'published',
        approved_by = $2,
        approved_at = now(),
        published_question_id = $3
      WHERE id = $1
    `, [draftId, userId, question.id]);

    const coverage = await rebuildTopicCoverage(draft.topic_id);

    return res.json({
      success: true,
      data: {
        question,
        coverage
      }
    });
  } catch (err) {
    console.error('APPROVE_PUBLISH_DRAFT_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to publish draft'
    });
  }
});

router.post('/rooms/:roomId/start-challenge', requireAuth, async (req, res) => {
  try {
    const roomId = String(req.params.roomId);
    const userId = String(req.user.id);

    const {
      topic_id,
      question_count = 10
    } = req.body || {};

    if (!topic_id) {
      return res.status(400).json({
        success: false,
        error: 'topic_id is required'
      });
    }

    const roomResult = await db.query(`
      SELECT *
      FROM study_rooms
      WHERE id = $1
      LIMIT 1
    `, [roomId]);

    if (!roomResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }

    const room = roomResult.rows[0];

    const questionsResult = await db.query(`
      SELECT q.*
      FROM questions q
      WHERE q.topic_id = $1
        AND COALESCE(q.is_active, true) = true
      ORDER BY RANDOM()
      LIMIT $2
    `, [topic_id, Number(question_count)]);

    await db.query(`
      INSERT INTO room_study_events (
        room_id,
        user_id,
        event_type,
        payload
      )
      VALUES ($1, $2, 'started_challenge', $3::jsonb)
    `, [
      roomId,
      userId,
      JSON.stringify({
        topic_id,
        question_count: Number(question_count),
        room_mode: 'group_challenge'
      })
    ]);

    // If you already have socket.io available in this file or globally, emit here.
    // Example:
    // req.app.get('io')?.to(`room:${roomId}`).emit('room:study_event', {...})

    return res.json({
      success: true,
      data: {
        room_id: room.id,
        mode: 'group_challenge',
        topic_id,
        questions: questionsResult.rows
      }
    });
  } catch (err) {
    console.error('ROOM_START_CHALLENGE_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/learn/rooms/join
 */
router.post('/rooms/join', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { invite_code } = req.body;

    if (!invite_code) {
      return res.status(400).json({
        success: false,
        error: 'invite_code is required'
      });
    }

    const roomResult = await db.query(
      `
      SELECT *
      FROM study_rooms
      WHERE invite_code = $1
      LIMIT 1
      `,
      [String(invite_code).trim().toUpperCase()]
    );

    if (!roomResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }

    const room = roomResult.rows[0];

    if (room.status === 'ended') {
      return res.status(400).json({
        success: false,
        error: 'Room has already ended'
      });
    }

    const countResult = await db.query(
      `
      SELECT COUNT(*)::int AS count
      FROM study_room_members
      WHERE room_id = $1
      `,
      [room.id]
    );

    const memberCount = countResult.rows[0]?.count || 0;

    const existingMember = await userIsRoomMember(room.id, userId);

    if (!existingMember && memberCount >= room.max_members) {
      return res.status(400).json({
        success: false,
        error: 'Room is full'
      });
    }

    await db.query(
      `
      INSERT INTO study_room_members (room_id, user_id, role, is_online, last_seen_at)
      VALUES ($1,$2,'member',true,now())
      ON CONFLICT (room_id, user_id)
      DO UPDATE SET is_online = true, last_seen_at = now()
      `,
      [room.id, userId]
    );

    return res.json({
      success: true,
      data: room
    });
  } catch (err) {
    console.error('LEARN_JOIN_ROOM_ERROR', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to join room'
    });
  }
});

router.get('/available-subjects', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        s.id,
        s.name,
        COALESCE(s.exam_type, 'general') AS exam_type,
        COUNT(q.id)::int AS question_count,
        CASE WHEN COUNT(q.id) > 0 THEN true ELSE false END AS is_available
      FROM subjects s
      LEFT JOIN questions q
        ON q.subject_id = s.id
       AND q.is_active = true
      GROUP BY s.id, s.name, s.exam_type
      ORDER BY exam_type, s.name
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('AVAILABLE_SUBJECTS_ERROR:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/recommended-practice', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const limit = Math.min(Number(req.query.limit || 10), 20);

    const weak = await db.query(
      `
      SELECT
        swa.subject_id,
        swa.topic_id,
        swa.exam_type,
        swa.weakness_score,
        s.name AS subject_name,
        t.name AS topic_name
      FROM student_weak_areas swa
      JOIN subjects s ON s.id = swa.subject_id
      JOIN topics t ON t.id = swa.topic_id
      WHERE swa.user_id = $1
      ORDER BY swa.weakness_score DESC, swa.updated_at ASC
      LIMIT 1
      `,
      [userId]
    );

    if (!weak.rows.length) {
      return res.json({
        success: true,
        data: null,
        message: 'No weak area yet. Keep practicing to unlock recommendations.'
      });
    }

    const target = weak.rows[0];

    const questions = await db.query(
      `
      SELECT
        q.id,
        q.subject_id,
        q.topic_id,
        q.question_text,
        q.explanation,
        q.difficulty,
        q.year,
        q.exam_type,
        COALESCE(
          json_agg(
            json_build_object(
              'id', qo.id,
              'option_text', qo.text
            )
            ORDER BY qo.created_at ASC
          ) FILTER (WHERE qo.id IS NOT NULL),
          '[]'
        ) AS options
      FROM questions q
      LEFT JOIN question_options qo ON qo.question_id = q.id
      WHERE q.topic_id = $1
        AND q.is_active = true
      GROUP BY q.id
      ORDER BY q.difficulty ASC, random()
      LIMIT $2
      `,
      [target.topic_id, limit]
    );

    return res.json({
      success: true,
      data: {
        recommendation: target,
        questions: questions.rows
      }
    });
  } catch (err) {
    console.error('RECOMMENDED_PRACTICE_ERROR:', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/learn/rooms/:id
 */
router.get('/rooms/:id', requireAuth, async (req, res) => {
  try {
    const roomId = req.params.id;
    const userId = String(req.user.id);

    const room = await getRoomById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }

    const isMember = await userIsRoomMember(roomId, userId);

    if (!room.is_public && !isMember && room.host_user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden'
      });
    }

    const members = await getRoomMembers(roomId);
    const messages = await getRoomMessages(roomId);
    const currentQuestion = await getCurrentQuestion(room.current_question_id);

    return res.json({
      success: true,
      data: {
        room,
        members,
        messages,
        currentQuestion
      }
    });
  } catch (err) {
    console.error('LEARN_GET_ROOM_ERROR', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to load room'
    });
  }
});

router.get('/topics/:topicId/notes', async (req, res) => {
  try {
const topicId = String(req.params.topicId || '').trim();

const isUUID = (v) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

if (!isUUID(topicId)) {
  return res.status(400).json({
    success: false,
    error: 'Valid topic_id is required'
  });
}

    const result = await db.query(`
      SELECT
        id,
        title,
        summary,
        key_points,
        worked_example,
        memory_tip,
        source_type,
        status,
        created_at,
        updated_at
      FROM topic_notes
      WHERE topic_id = $1
        AND status = 'published'
      ORDER BY created_at DESC
      LIMIT 20
    `, [topicId]);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('TOPIC_NOTES_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/rooms/:roomId/leaderboard', requireAuth, async (req, res) => {
  try {
const rawRoomId = String(req.params.roomId || '').trim();

const isUUID = (v) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

let roomId = rawRoomId;

if (!isUUID(roomId)) {
  const lookup = await db.query(
    `SELECT id FROM study_rooms WHERE invite_code = $1 LIMIT 1`,
    [roomId.toUpperCase()]
  );

  if (!lookup.rows.length) {
    return res.status(404).json({
      success: false,
      error: 'Room not found'
    });
  }

  roomId = lookup.rows[0].id;
}

    const result = await db.query(`
      SELECT
        rm.user_id,
        rm.score
      FROM study_room_members rm
      WHERE rm.room_id = $1
      ORDER BY rm.score DESC, rm.joined_at ASC
      LIMIT 20
    `, [roomId]);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('ROOM_LEADERBOARD_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/learn/sessions/:sessionId/submit-answer
 */
/**
 * POST /api/learn/sessions/:sessionId/submit-answer
 */
router.post('/sessions/:sessionId/submit-answer', requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId);
    const userId = String(req.user.id);

    const {
      question_id,
      selected_option_id: rawSelectedOptionId = null,
      time_spent_sec = null
    } = req.body;

    const normalizeUuid = (value) => {
      if (value == null) return null;
      const str = String(value).trim();
      const match = str.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      );
      return match ? match[0] : str;
    };

    const isUUID = (v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    const selected_option_id = rawSelectedOptionId
      ? normalizeUuid(rawSelectedOptionId)
      : null;

    if (!question_id) {
      return res.status(400).json({
        success: false,
        error: 'question_id is required'
      });
    }

    if (selected_option_id && !isUUID(selected_option_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid selected_option_id format',
        received: selected_option_id
      });
    }

    const sessionResult = await db.query(`
      SELECT *
      FROM study_sessions
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `, [sessionId, userId]);

    if (!sessionResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    const session = sessionResult.rows[0];

    let isCorrect = false;

    if (selected_option_id) {
      const optionResult = await db.query(`
        SELECT id, is_correct
        FROM question_options
        WHERE id = $1
          AND question_id = $2
        LIMIT 1
      `, [selected_option_id, question_id]);

      if (!optionResult.rows.length) {
        return res.status(400).json({
          success: false,
          error: 'Selected option does not belong to this question'
        });
      }

      isCorrect = !!optionResult.rows[0].is_correct;
    }

    const answerResult = await db.query(`
      INSERT INTO study_session_answers (
        session_id,
        question_id,
        selected_option_id,
        is_correct,
        time_spent_sec,
        answered_at
      )
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (session_id, question_id)
      DO UPDATE SET
        selected_option_id = EXCLUDED.selected_option_id,
        is_correct = EXCLUDED.is_correct,
        time_spent_sec = EXCLUDED.time_spent_sec,
        answered_at = now()
      RETURNING *
    `, [
      sessionId,
      question_id,
      selected_option_id,
      isCorrect,
      time_spent_sec
    ]);

const questionMetaResult = await db.query(`
  SELECT id, topic_id, skill_tag, subject_id, exam_id, stem, explanation
  FROM questions
  WHERE id = $1
  LIMIT 1
`, [question_id]);

    const topicId = questionMetaResult.rows[0]?.topic_id || null;
    const skillTag = questionMetaResult.rows[0]?.skill_tag || null;
    const subjectId = questionMetaResult.rows[0]?.subject_id || null;
    const examId = questionMetaResult.rows[0]?.exam_id || null;

// Update weak-area intelligence safely
try {
  if (userId && subjectId && topicId) {
    await db.query(
      `
      SELECT update_student_weak_area($1, $2, $3, $4, $5)
      `,
      [
        userId,
        subjectId,
        topicId,
        String(examId || session.exam_id || 'general'),
        !!isCorrect
      ]
    );
  }
} catch (err) {
  console.error('WEAK_AREA_UPDATE_ERROR:', err.message);
}

    let mastery = null;
    if (topicId) {
      mastery = await updateTopicMastery({
        userId,
        topicId,
        isCorrect,
        timeSpentSec: time_spent_sec
      });
    }

    let skillMastery = null;

    try {
      if (topicId && skillTag) {
        const currentSkillResult = await db.query(`
          SELECT *
          FROM student_skill_mastery
          WHERE user_id = $1
            AND topic_id = $2
            AND skill_tag = $3
          LIMIT 1
        `, [userId, topicId, skillTag]);

        const existingSkill = currentSkillResult.rows[0] || null;

        const prevCorrect = Number(existingSkill?.correct_count || 0);
        const prevWrong = Number(existingSkill?.wrong_count || 0);

        const correctCount = isCorrect ? prevCorrect + 1 : prevCorrect;
        const wrongCount = isCorrect ? prevWrong : prevWrong + 1;
        const masteryScore = Math.max(
          0,
          Math.min(100, (correctCount * 10) - (wrongCount * 6))
        );

        const skillResult = await db.query(`
          INSERT INTO student_skill_mastery (
            user_id,
            topic_id,
            skill_tag,
            correct_count,
            wrong_count,
            mastery_score,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, now())
          ON CONFLICT (user_id, topic_id, skill_tag)
          DO UPDATE SET
            correct_count = EXCLUDED.correct_count,
            wrong_count = EXCLUDED.wrong_count,
            mastery_score = EXCLUDED.mastery_score,
            updated_at = now()
          RETURNING *
        `, [
          userId,
          topicId,
          skillTag,
          correctCount,
          wrongCount,
          masteryScore
        ]);

        skillMastery = skillResult.rows[0] || null;
      }
    } catch (err) {
      console.error('SKILL_MASTERY_UPDATE_ERROR', err);
    }

    let leaderboardEvent = null;

    try {
      const leaderboardInsert = await db.query(`
        INSERT INTO leaderboard_events (
          user_id,
          room_id,
          session_id,
          exam_id,
          subject_id,
          topic_id,
          event_type,
          score_delta,
          meta
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING *
      `, [
        userId,
        null,
        sessionId,
        examId,
        subjectId,
        topicId,
        isCorrect ? 'correct_answer' : 'wrong_answer',
        isCorrect ? 10 : 0,
        JSON.stringify({
          is_correct: isCorrect,
          time_spent_sec: time_spent_sec || 0
        })
      ]);

      leaderboardEvent = leaderboardInsert.rows[0] || null;
    } catch (err) {
      console.error('SESSION_LEADERBOARD_EVENT_ERROR', err);
    }

    const masteryAfter = topicId ? await getTopicMastery(userId, topicId) : null;
const questionDetail = questionMetaResult.rows[0] || null;

const aiFeedback = buildAIFeedback({
  question: questionDetail,
  isCorrect,
  mastery: masteryAfter || mastery,
  skillTag
});

try {
  await recordAttempt({
    userId,
    questionId: question_id,
    topicId,
    subjectId,
    selectedOptionId: selected_option_id,
    isCorrect,
    timeSpentSec: time_spent_sec || 0
  });
} catch (err) {
  console.error('STUDENT_ATTEMPT_RECORD_ERROR', err);
}
    let nextQuestion = null;
    let strategy = null;
    let weakSkillTag = null;
    let completed = false;

    if (!session.ended_at && topicId) {
      const targetDifficulty = chooseDifficulty(masteryAfter || mastery);

      const nextQuestionResult = await getNextAdaptiveQuestion({
        userId,
        topicId,
        sessionId,
        targetDifficulty
      });

      nextQuestion = nextQuestionResult.question || null;
      strategy = nextQuestionResult.strategy || null;
      weakSkillTag = nextQuestionResult.weakSkillTag || null;

      if (!nextQuestion) {
        completed = true;

        await db.query(`
          UPDATE study_sessions
          SET ended_at = now()
          WHERE id = $1
        `, [sessionId]);
      }
    }

const answeredCountResult = await db.query(
  `
  SELECT COUNT(*)::int AS answered_count
  FROM study_session_answers
  WHERE session_id = $1
  `,
  [sessionId]
);

const answeredCount = Number(answeredCountResult.rows[0]?.answered_count || 0);

const totalAvailableResult = topicId
  ? await db.query(
      `
      SELECT COUNT(q.id)::int AS total_available
      FROM questions q
      WHERE q.topic_id = $1
        AND COALESCE(q.is_active, true) = true
        AND COALESCE(q.review_status, 'published') IN ('published', 'approved')
        AND COALESCE(q.stem, q.question) IS NOT NULL
      `,
      [topicId]
    )
  : { rows: [{ total_available: answeredCount }] };

const totalAvailable = Number(totalAvailableResult.rows[0]?.total_available || answeredCount);

return res.json({
  success: true,
  data: answerResult.rows[0],
  is_correct: isCorrect,
  mastery: masteryAfter || mastery,
  skill_mastery: skillMastery,
  leaderboard_event: leaderboardEvent,

  next_question: nextQuestion,
  questions: nextQuestion ? [nextQuestion] : [],

current_index: answeredCount,
question_count: totalAvailable,
total_available: totalAvailable,
target_count: totalAvailable,
completed: answeredCount >= totalAvailable,

  strategy,
  weak_skill_tag: weakSkillTag,
  ai_feedback: aiFeedback
});
  } catch (err) {
    console.error('SESSION_SUBMIT_ANSWER_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/reviews/due', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);

    const result = await db.query(`
      SELECT stm.*, t.name AS topic_name, s.name AS subject_name
      FROM student_topic_mastery stm
      JOIN topics t ON t.id = stm.topic_id
      LEFT JOIN subjects s ON s.id = t.subject_id
      WHERE stm.user_id = $1
        AND stm.next_review_at IS NOT NULL
        AND stm.next_review_at <= now()
      ORDER BY stm.next_review_at ASC, stm.mastery_score ASC
      LIMIT 50
    `, [userId]);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('REVIEWS_DUE_ERROR', err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/snap-question', requireAuth, express.json({ limit: '8mb' }), async (req, res) => {
  try {
    const { questionText, imageBase64, imageUrl } = req.body || {};

    if (!questionText && !imageBase64 && !imageUrl) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'Send questionText, imageBase64, or imageUrl.'
      });
    }

    const prompt = `
You are ProxiNG Snap AI. Solve the learner's question.

Input:
${questionText || imageUrl || 'Image was uploaded as base64. If image reading is unavailable, say so clearly.'}

Return valid JSON only:
{
  "question": "detected question",
  "answer": "final answer",
  "steps": ["step 1", "step 2"],
  "confidence": 0.9
}
`;

    const solution = await aiJSON({
      feature: 'snap_question',
      task: 'solve_question_from_photo_or_text',
      maxTokens: 900,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'You are an expert exam tutor. Return valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    return res.json({
      ok: true,
      solution
    });
  } catch (err) {
    console.error('snap-question error:', err);

    return res.status(500).json({
      ok: false,
      error: 'AI_FAILED',
      message: err.message || 'Failed to solve question.'
    });
  }
});

router.post('/topics/:topicId/start-review', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const topicId = String(req.params.topicId);

    const mastery = await getTopicMastery(userId, topicId);
    const targetDifficulty = Math.max(1, Math.min(3, chooseDifficulty(mastery)));

    const sessionResult = await db.query(`
      INSERT INTO study_sessions (
        user_id,
        room_id,
        topic_id,
        subject_id,
        mode,
        question_source_mode,
        started_at
      )
      SELECT
        $1,
        NULL,
        t.id,
        t.subject_id,
        'review',
        'adaptive',
        now()
      FROM topics t
      WHERE t.id = $2
      RETURNING *
    `, [userId, topicId]);

    if (!sessionResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Topic not found'
      });
    }

    const session = sessionResult.rows[0];

    const nextQuestionResult = await getNextAdaptiveQuestion({
      userId,
      topicId,
      sessionId: session.id,
      targetDifficulty
    });

    return res.json({
      success: true,
      data: {
        session,
        adaptive: {
          mastery: mastery || null,
          targetDifficulty
        },
        strategy: nextQuestionResult.strategy,
        weak_skill_tag: nextQuestionResult.weakSkillTag || null,
        questions: nextQuestionResult.question ? [nextQuestionResult.question] : []
      }
    });
  } catch (err) {
    console.error('START_REVIEW_ERROR', err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/topics/:topicId/start-adaptive', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const topicId = String(req.params.topicId);

    const requestedLimit = Math.max(
      5,
      Math.min(Number(req.body?.limit || req.query?.limit || 20), 50)
    );

    const mastery = await getTopicMastery(userId, topicId);
    const targetDifficulty = chooseDifficulty(mastery);

    const sessionResult = await db.query(`
      INSERT INTO study_sessions (
        user_id,
        room_id,
        topic_id,
        subject_id,
        mode,
        question_source_mode,
        started_at
      )
      SELECT
        $1,
        NULL,
        t.id,
        t.subject_id,
        'adaptive',
        'mixed',
        now()
      FROM topics t
      WHERE t.id = $2
      RETURNING *
    `, [userId, topicId]);

    if (!sessionResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Topic not found'
      });
    }

    const session = sessionResult.rows[0];
    const subjectId = session.subject_id;

    const questionsResult = await db.query(`
      SELECT
        q.*,
        COALESCE(t.name, 'Exam Practice') AS topic_name
      FROM questions q
      LEFT JOIN topics t ON t.id = q.topic_id
      WHERE q.subject_id = $1
        AND COALESCE(q.is_active, true) = true
        AND COALESCE(q.review_status, 'published') IN ('published', 'approved')
        AND COALESCE(q.stem, q.question) IS NOT NULL
      ORDER BY
        CASE WHEN q.topic_id = $2 THEN 0 ELSE 1 END,
        CASE WHEN q.difficulty = $3 THEN 0 ELSE 1 END,
        RANDOM()
      LIMIT $4
    `, [subjectId, topicId, targetDifficulty, requestedLimit]);

    const questions = questionsResult.rows.map(q => ({
      ...q,
      stem: q.stem || q.question,
      topic_name: q.topic_name || q.topic || q.topic_title || 'Exam Practice'
    }));

    console.log('[ADAPTIVE_DEBUG]', {
      subjectId,
      topicId,
      requestedLimit,
      targetDifficulty,
      finalReturned: questions.length,
      sampleQuestionIds: questions.slice(0, 5).map(q => q.id)
    });

if (!questions.length) {
  await db.query(
    `UPDATE study_sessions SET ended_at = now() WHERE id = $1`,
    [session.id]
  );

  return res.json({
    success: true,
    completed: true,
    data: {
      session,
      adaptive: {
        mastery: mastery || null,
        targetDifficulty
      },
      strategy: 'no_questions',
      questions: [],
      current_index: 0,
      question_count: 0,
      total_available: 0
    }
  });
}

console.log('[ADAPTIVE_RESPONSE]', {
  current_index: 1,
  question_count: questions.length,
  total_available: questions.length,
  returnedIds: questions.map(q => q.id).slice(0, 5)
});

return res.json({
  success: true,
  completed: false,
  data: {
    session,
    adaptive: {
      mastery: mastery || null,
      targetDifficulty
    },
    strategy: 'batch_start',
    weak_skill_tag: null,
    questions,
    current_index: 1,
    question_count: questions.length,
    total_available: questions.length
  }
});
  } catch (err) {
    console.error('[ADAPTIVE_ERROR_FULL]', err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/adaptive/tutor', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);

    const {
      session_id,
      question_id,
      topic_id,
      subject_id,
      exam_type,
      subject_name,
      topic_name,
      question,
      selected_answer,
      correct_answer,
      explanation,
      is_correct,
      intent = 'explain_answer'
    } = req.body || {};

    if (!question_id && !question) {
      return res.status(400).json({
        success: false,
        error: 'question_id or question is required'
      });
    }

    let questionData = null;

    if (question_id) {
      const questionResult = await db.query(
        `
        SELECT
          q.id,
          q.stem,
          q.question,
          q.explanation,
          q.topic_id,
          q.subject_id,
          q.exam_type,
          q.difficulty,
          t.name AS topic_name,
          s.name AS subject_name,
          COALESCE(
            json_agg(
              json_build_object(
                'id', qo.id,
                'label', qo.label,
                'text', qo.text,
                'is_correct', qo.is_correct
              )
              ORDER BY qo.label
            ) FILTER (WHERE qo.id IS NOT NULL),
            '[]'
          ) AS options
        FROM questions q
        LEFT JOIN topics t ON t.id = q.topic_id
        LEFT JOIN subjects s ON s.id = q.subject_id
        LEFT JOIN question_options qo ON qo.question_id = q.id
        WHERE q.id = $1
        GROUP BY q.id, t.name, s.name
        LIMIT 1
        `,
        [question_id]
      );

      questionData = questionResult.rows[0] || null;
    }

    const resolvedTopicId = topic_id || questionData?.topic_id || null;

    let knowledge = null;

    if (resolvedTopicId) {
      const knowledgeResult = await db.query(
        `
        SELECT
          key_concepts,
          memory_aids,
          common_traps,
          worked_examples,
          exam_tips,
          past_question_patterns
        FROM topic_knowledge
        WHERE topic_id = $1
        LIMIT 1
        `,
        [resolvedTopicId]
      );

      knowledge = knowledgeResult.rows[0] || null;
    }

    const stem =
      question ||
      questionData?.stem ||
      questionData?.question ||
      '';

    const finalExplanation =
      explanation ||
      questionData?.explanation ||
      '';

    const finalTopicName =
      topic_name ||
      questionData?.topic_name ||
      'Exam Practice';

    const finalSubjectName =
      subject_name ||
      questionData?.subject_name ||
      'Subject';

    const finalExamType =
      exam_type ||
      questionData?.exam_type ||
      'exam';

    const options = questionData?.options || [];

    const correctOption =
      correct_answer ||
      options.find(o => o.is_correct)?.text ||
      null;

    const prompt = `
You are ProxiNG AI Tutor.

Teach the student like a patient exam coach.

Exam: ${finalExamType}
Subject: ${finalSubjectName}
Topic: ${finalTopicName}

Question:
${stem}

Student answer:
${selected_answer || 'Not provided'}

Correct answer:
${correct_answer || correctOption || 'Not provided'}

Was student correct?
${is_correct === true ? 'Yes' : is_correct === false ? 'No' : 'Unknown'}

Existing explanation:
${finalExplanation || 'None'}

Topic knowledge:
${JSON.stringify(knowledge || {}, null, 2)}

Return valid JSON only with this shape:
{
  "title": "short title",
  "summary": "short student-friendly summary",
  "teaching": ["step 1", "step 2", "step 3"],
  "why_correct": "why the correct answer is correct",
  "why_student_wrong": "if wrong, explain the misconception. If correct, null",
  "key_concept": "main concept",
  "memory_trick": "simple memory aid",
  "common_trap": "common trap",
  "exam_tip": "exam strategy",
  "similar_question": {
    "question": "one related practice question",
    "options": ["A", "B", "C", "D"],
    "answer": "correct answer",
    "explanation": "short explanation"
  }
}
`;

    const tutorResponse = await aiJSON({
      feature: 'adaptive_ai_tutor',
      task: intent,
      maxTokens: 1200,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: 'You are an expert exam tutor. Return valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    return res.json({
      success: true,
      data: {
        session_id: session_id || null,
        question_id: question_id || null,
        topic_id: resolvedTopicId,
        exam_type: finalExamType,
        subject_name: finalSubjectName,
        topic_name: finalTopicName,
        tutor: tutorResponse
      }
    });
  } catch (err) {
    console.error('[ADAPTIVE_TUTOR_ERROR]', err);

    return res.status(500).json({
      success: false,
      error: err.message || 'AI Tutor failed'
    });
  }
});

router.get('/topic-highlights', requireAuth, async (req, res) => {
  try {
    const {
      subject_id,
      topic_id,
      exam_type
    } = req.query;

    if (!subject_id || !topic_id || !exam_type) {
      return res.status(400).json({
        success: false,
        error: 'subject_id, topic_id and exam_type are required'
      });
    }

    const result = await db.query(
      `
      SELECT
        th.id,
        th.exam_type,
        th.title,
        th.summary,
        th.key_points,
        th.formulas,
        th.common_mistakes,
        th.exam_tips,
        s.name AS subject_name,
        t.name AS topic_name
      FROM topic_highlights th
      JOIN subjects s ON s.id = th.subject_id
      JOIN topics t ON t.id = th.topic_id
      WHERE th.subject_id = $1
        AND th.topic_id = $2
        AND th.exam_type = $3
      ORDER BY th.created_at DESC
      LIMIT 1
      `,
      [subject_id, topic_id, exam_type]
    );

    return res.json({
      success: true,
      data: result.rows[0] || null
    });
  } catch (err) {
    console.error('TOPIC_HIGHLIGHTS_ERROR:', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/weak-areas', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);

    const result = await db.query(
      `
      SELECT
        swa.id,
        swa.exam_type,
        swa.weakness_score,
        swa.correct_count,
        swa.wrong_count,
        swa.last_practiced_at,
        s.name AS subject_name,
        t.name AS topic_name,
        swa.subject_id,
        swa.topic_id
      FROM student_weak_areas swa
      LEFT JOIN subjects s ON s.id = swa.subject_id
      LEFT JOIN topics t ON t.id = swa.topic_id
      WHERE swa.user_id = $1
      ORDER BY swa.weakness_score DESC, swa.updated_at DESC
      LIMIT 10
      `,
      [userId]
    );

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('WEAK_AREAS_ERROR:', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/sessions/:sessionId/next-question', requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId);
    const userId = String(req.user.id);

    const sessionResult = await db.query(`
      SELECT ss.*
      FROM study_sessions ss
      WHERE ss.id = $1
        AND ss.user_id = $2
      LIMIT 1
    `, [sessionId, userId]);

    if (!sessionResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Adaptive session not found'
      });
    }

    const session = sessionResult.rows[0];

    if (session.mode !== 'adaptive') {
      return res.status(400).json({
        success: false,
        error: 'Session is not adaptive'
      });
    }

    if (!session.topic_id) {
      return res.status(400).json({
        success: false,
        error: 'Session has no topic'
      });
    }

    if (session.ended_at) {
      return res.json({
        success: true,
        completed: true,
        data: {
          session_id: session.id,
          message: 'Session already completed'
        }
      });
    }

    const mastery = await getTopicMastery(userId, session.topic_id);
    const targetDifficulty = chooseDifficulty(mastery);

    const nextQuestionResult = await getNextAdaptiveQuestion({
userId,
      topicId: session.topic_id,
      sessionId: session.id,
      targetDifficulty
    });

    if (!nextQuestionResult.question) {
      await db.query(`
        UPDATE study_sessions
        SET ended_at = now()
        WHERE id = $1
      `, [session.id]);

      return res.json({
        success: true,
        completed: true,
        data: {
          session_id: session.id,
          strategy: nextQuestionResult.strategy,
          adaptive: {
            mastery: mastery || null,
            targetDifficulty
          }
        }
      });
    }

    return res.json({
      success: true,
      completed: false,
      data: {
        session_id: session.id,
        strategy: nextQuestionResult.strategy,
        adaptive: {
          mastery: mastery || null,
          targetDifficulty
        },
        question: nextQuestionResult.question
      }
    });
  } catch (err) {
    console.error('ADAPTIVE_NEXT_QUESTION_ERROR', err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/learn/rooms/:id/messages
 */
router.post('/rooms/:id/messages', requireAuth, async (req, res) => {
  try {
    const roomId = req.params.id;
    const userId = String(req.user.id);
    const { message } = req.body;

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        success: false,
        error: 'message is required'
      });
    }

    const isMember = await userIsRoomMember(roomId, userId);

    if (!isMember) {
      return res.status(403).json({
        success: false,
        error: 'You are not a member of this room'
      });
    }

    const result = await db.query(
      `
      INSERT INTO study_room_messages
      (room_id, user_id, sender_type, message)
      VALUES ($1,$2,'student',$3)
      RETURNING *
      `,
      [roomId, userId, String(message).trim()]
    );

    return res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (err) {
    console.error('LEARN_POST_MESSAGE_ERROR', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to post message'
    });
  }
});

router.get('/rooms/:roomId/leaderboard', requireAuth, async (req, res) => {
  try {
const rawRoomId = String(req.params.roomId || '').trim();

const isUUID = (v) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

let roomId = rawRoomId;

if (!isUUID(roomId)) {
  const lookup = await db.query(
    `SELECT id FROM study_rooms WHERE invite_code = $1 LIMIT 1`,
    [roomId.toUpperCase()]
  );

  if (!lookup.rows.length) {
    return res.status(404).json({
      success: false,
      error: 'Room not found'
    });
  }

  roomId = lookup.rows[0].id;
}

    const result = await db.query(`
      SELECT rl.user_id, rl.total_points
      FROM room_leaderboard rl
      WHERE rl.room_id = $1
      ORDER BY rl.total_points DESC, rl.user_id ASC
      LIMIT 50
    `, [roomId]);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('ROOM_LEADERBOARD_ERROR', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch room leaderboard'
    });
  }
});

router.get('/subjects/:subjectId/topics', async (req, res) => {
  const { subjectId } = req.params;

  const result = await db.query(
    `
SELECT
  t.id,
  t.name,
  t.subject_id,
  COUNT(q.id)::int AS question_count
FROM topics t
JOIN questions q
  ON q.topic_id = t.id
  AND q.is_active = true
WHERE t.subject_id = $1
GROUP BY t.id, t.name, t.subject_id
HAVING COUNT(q.id) > 0
ORDER BY t.name ASC
    `,
    [subjectId]
  );

  res.json({ topics: result.rows });
});

router.get('/subjects/:subjectId/diagnostic', async (req, res) => {
  const { subjectId } = req.params;

  const result = await db.query(
    `
SELECT
  q.id,
  COALESCE(q.stem, q.question) AS item,
  q.explanation,
  q.topic_id,
  (
    SELECT json_agg(
      json_build_object(
        'id', qo.id,
        'text', qo.text,
        'label', qo.label
      )
      ORDER BY qo.label
    )
    FROM question_options qo
    WHERE qo.question_id = q.id
  ) AS options
FROM questions q
JOIN topics t ON t.id = q.topic_id
WHERE t.subject_id = $1
ORDER BY RANDOM()
LIMIT 10
    `,
    [subjectId]
  );

  res.json({
    mode: 'diagnostic',
    questions: result.rows,
  });
});

router.get('/subjects/:subjectId/leaderboard', requireAuth, async (req, res) => {
  try {
    const subjectId = String(req.params.subjectId);

    const result = await db.query(`
      SELECT sl.user_id, sl.total_points
      FROM subject_leaderboard sl
      WHERE sl.subject_id = $1
      ORDER BY sl.total_points DESC, sl.user_id ASC
      LIMIT 100
    `, [subjectId]);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('SUBJECT_LEADERBOARD_ERROR', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch subject leaderboard'
    });
  }
});

router.get('/exams/:examId/leaderboard', requireAuth, async (req, res) => {
  try {
    const examId = String(req.params.examId);

    const result = await db.query(`
      SELECT el.user_id, el.total_points
      FROM exam_leaderboard el
      WHERE el.exam_id = $1
      ORDER BY el.total_points DESC, el.user_id ASC
      LIMIT 100
    `, [examId]);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('EXAM_LEADERBOARD_ERROR', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch exam leaderboard'
    });
  }
});

/**
 * POST /api/learn/rooms/:id/start
 */
router.post('/rooms/:id/start', requireAuth, async (req, res) => {
  const client = await db.getClient();

  try {
    const roomId = req.params.id;
    const userId = String(req.user.id);

    await client.query('BEGIN');

    const roomResult = await client.query(
      `
      SELECT *
      FROM study_rooms
      WHERE id = $1
      LIMIT 1
      `,
      [roomId]
    );

    if (!roomResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }

    const room = roomResult.rows[0];

    if (String(room.host_user_id) !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        error: 'Only host can start room'
      });
    }

    const questionsResult = await client.query(
      `
      SELECT q.id
      FROM questions q
      JOIN topics t ON t.id = q.topic_id
      WHERE ($1::uuid IS NULL OR t.subject_id = $1::uuid)
      ORDER BY q.created_at DESC
      LIMIT 5
      `,
      [room.subject_id]
    );

    if (!questionsResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'No questions available for this room'
      });
    }

    await client.query(
      `DELETE FROM study_room_questions WHERE room_id = $1`,
      [roomId]
    );

    for (let i = 0; i < questionsResult.rows.length; i += 1) {
      await client.query(
        `
        INSERT INTO study_room_questions (room_id, question_id, position)
        VALUES ($1,$2,$3)
        `,
        [roomId, questionsResult.rows[i].id, i + 1]
      );
    }

    const firstQuestionId = questionsResult.rows[0].id;

    const updateResult = await client.query(
      `
      UPDATE study_rooms
      SET status = 'live',
          current_question_id = $2,
          started_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [roomId, firstQuestionId]
    );

    await client.query(
      `
      INSERT INTO study_room_messages
      (room_id, user_id, sender_type, message, meta)
      VALUES ($1, NULL, 'system', $2, $3::jsonb)
      `,
      [roomId, 'Study session started', JSON.stringify({ event: 'room_started' })]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      data: updateResult.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('LEARN_START_ROOM_ERROR', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to start room'
    });
  } finally {
    client.release();
  }
});

/**
 * POST /api/learn/rooms/:id/next-question
 */
router.post('/rooms/:id/next-question', requireAuth, async (req, res) => {
  try {
    const roomId = req.params.id;
    const userId = String(req.user.id);

    const room = await getRoomById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }

    if (String(room.host_user_id) !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Only host can move to next question'
      });
    }

    const orderedResult = await db.query(
      `
      SELECT question_id, position
      FROM study_room_questions
      WHERE room_id = $1
      ORDER BY position ASC
      `,
      [roomId]
    );

    const ordered = orderedResult.rows;

    if (!ordered.length) {
      return res.status(400).json({
        success: false,
        error: 'No room questions found'
      });
    }

    const currentIndex = ordered.findIndex(
      (row) => String(row.question_id) === String(room.current_question_id)
    );

    const nextItem = ordered[currentIndex + 1];

    if (!nextItem) {
      const endResult = await db.query(
        `
        UPDATE study_rooms
        SET status = 'ended', ended_at = now()
        WHERE id = $1
        RETURNING *
        `,
        [roomId]
      );

      await db.query(
        `
        INSERT INTO study_room_messages
        (room_id, user_id, sender_type, message, meta)
        VALUES ($1, NULL, 'system', $2, $3::jsonb)
        `,
        [roomId, 'Study session ended', JSON.stringify({ event: 'room_ended' })]
      );

      return res.json({
        success: true,
        ended: true,
        data: endResult.rows[0]
      });
    }

    const updateResult = await db.query(
      `
      UPDATE study_rooms
      SET current_question_id = $2
      WHERE id = $1
      RETURNING *
      `,
      [roomId, nextItem.question_id]
    );

    await db.query(
      `
      INSERT INTO study_room_messages
      (room_id, user_id, sender_type, message, meta)
      VALUES ($1, NULL, 'system', $2, $3::jsonb)
      `,
      [
        roomId,
        'Moved to next question',
        JSON.stringify({ event: 'next_question', question_id: nextItem.question_id })
      ]
    );

    return res.json({
      success: true,
      ended: false,
      data: updateResult.rows[0]
    });
  } catch (err) {
    console.error('LEARN_NEXT_QUESTION_ERROR', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to move to next question'
    });
  }
});

/**
 * POST /api/learn/rooms/:id/submit-answer
 */

router.post('/rooms/:id/submit-answer', requireAuth, async (req, res) => {
  try {
    const roomId = String(req.params.id);
    const userId = String(req.user.id);

    const {
      question_id,
      selected_option_id: rawSelectedOptionId = null,
      time_spent_sec = null
    } = req.body;

    const normalizeUuid = (value) => {
      if (value == null) return null;

      let v = String(value).trim();

      // unwrap escaped quotes and surrounding quotes repeatedly
      v = v.replace(/\\"/g, '"');
      for (let i = 0; i < 5; i += 1) {
        const next = v.replace(/^["']+|["']+$/g, '').trim();
        if (next === v) break;
        v = next;
      }

      // if anything weird remains, extract the uuid-shaped part
      const match = v.match(
        /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
      );
      return match ? match[0] : v;
    };

    const isUUID = (v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    const selected_option_id = normalizeUuid(rawSelectedOptionId);
    const normalizedQuestionId = normalizeUuid(question_id);

    if (!normalizedQuestionId) {
      return res.status(400).json({
        success: false,
        error: 'question_id is required'
      });
    }

    if (!isUUID(normalizedQuestionId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid question_id format',
        received: normalizedQuestionId
      });
    }

    if (selected_option_id && !isUUID(selected_option_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid selected_option_id format',
        received: selected_option_id
      });
    }

    const isMember = await userIsRoomMember(roomId, userId);
    if (!isMember) {
      return res.status(403).json({
        success: false,
        error: 'You are not a member of this room'
      });
    }

    let isCorrect = false;

    if (selected_option_id) {
      const optionResult = await db.query(
        `
        SELECT id, is_correct
        FROM question_options
        WHERE id = $1
          AND question_id = $2
        LIMIT 1
        `,
        [selected_option_id, normalizedQuestionId]
      );

      if (!optionResult.rows.length) {
        return res.status(400).json({
          success: false,
          error: 'Selected option does not belong to this question'
        });
      }

      isCorrect = !!optionResult.rows[0].is_correct;
    }

    const safeTimeSpent =
      time_spent_sec == null || time_spent_sec === ''
        ? null
        : Math.max(0, Number(time_spent_sec) || 0);

    const answerResult = await db.query(
      `
      INSERT INTO study_room_answers (
        room_id,
        question_id,
        user_id,
        selected_option_id,
        is_correct,
        time_spent_sec
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (room_id, question_id, user_id)
      DO UPDATE SET
        selected_option_id = EXCLUDED.selected_option_id,
        is_correct = EXCLUDED.is_correct,
        time_spent_sec = EXCLUDED.time_spent_sec,
        answered_at = now()
      RETURNING *
      `,
      [
        roomId,
        normalizedQuestionId,
        userId,
        selected_option_id,
        isCorrect,
        safeTimeSpent
      ]
    );

    if (isCorrect) {
      await db.query(
        `
        UPDATE study_room_members
        SET score = score + 10
        WHERE room_id = $1 AND user_id = $2
        `,
        [roomId, userId]
      );
    }

    let leaderboardEvent = null;

    try {
      const eventResult = await db.query(
        `
        INSERT INTO room_study_events (
          room_id,
          user_id,
          event_type,
          payload
        )
        VALUES ($1, $2, $3, $4::jsonb)
        RETURNING *
        `,
        [
          roomId,
          userId,
          isCorrect ? 'correct' : 'wrong',
          JSON.stringify({
            question_id: normalizedQuestionId,
            selected_option_id,
            score_delta: isCorrect ? 10 : 0
          })
        ]
      );

      leaderboardEvent = eventResult.rows[0] || null;

      const io = req.app.get('io');

      io?.to(`room:${roomId}`).emit('room:study_event', {
        room_id: roomId,
        user_id: userId,
        event_type: isCorrect ? 'correct' : 'wrong',
        score_delta: isCorrect ? 10 : 0,
        payload: {
          question_id: normalizedQuestionId,
          selected_option_id
        }
      });
    } catch (err) {
      console.error('ROOM_STUDY_EVENT_WRITE_ERROR', err);
    }

    let updatedScore = null;
    try {
      const scoreResult = await db.query(
        `
        SELECT score
        FROM study_room_members
        WHERE room_id = $1 AND user_id = $2
        LIMIT 1
        `,
        [roomId, userId]
      );
      updatedScore = scoreResult.rows[0]?.score ?? null;
    } catch (err) {
      console.error('ROOM_SCORE_FETCH_ERROR', err);
    }

    return res.json({
      success: true,
      data: answerResult.rows[0],
      is_correct: isCorrect,
      leaderboard_event: leaderboardEvent,
      score: updatedScore
    });
  } catch (err) {
    console.error('ROOM_SUBMIT_ANSWER_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to submit room answer'
    });
  }
});

router.get('/reviews/due', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);

    const result = await db.query(`
      SELECT stm.*, t.name AS topic_name, s.name AS subject_name
      FROM student_topic_mastery stm
      JOIN topics t ON t.id = stm.topic_id
      LEFT JOIN subjects s ON s.id = t.subject_id
      WHERE stm.user_id = $1
        AND stm.next_review_at IS NOT NULL
        AND stm.next_review_at <= now()
      ORDER BY stm.next_review_at ASC, stm.mastery_score ASC
      LIMIT 50
    `, [userId]);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('REVIEWS_DUE_ERROR', err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/topics/:topicId/start-review', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const topicId = String(req.params.topicId);

    const mastery = await getTopicMastery(userId, topicId);
    const targetDifficulty = Math.max(1, Math.min(3, chooseDifficulty(mastery)));

    const sessionResult = await db.query(`
      INSERT INTO study_sessions (
        user_id,
        room_id,
        topic_id,
        subject_id,
        mode,
        question_source_mode,
        started_at
      )
      SELECT
        $1,
        NULL,
        t.id,
        t.subject_id,
        'review',
        'adaptive',
        now()
      FROM topics t
      WHERE t.id = $2
      RETURNING *
    `, [userId, topicId]);

    if (!sessionResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Topic not found'
      });
    }

    const session = sessionResult.rows[0];

    const nextQuestionResult = await getNextAdaptiveQuestion({
      userId,
      topicId,
      sessionId: session.id,
      targetDifficulty
    });

    return res.json({
      success: true,
      data: {
        session,
        adaptive: {
          mastery: mastery || null,
          targetDifficulty
        },
        strategy: nextQuestionResult.strategy,
        weak_skill_tag: nextQuestionResult.weakSkillTag || null,
        questions: nextQuestionResult.question ? [nextQuestionResult.question] : []
      }
    });
  } catch (err) {
    console.error('START_REVIEW_ERROR', err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});


router.post('/exams/:examId/start-simulator', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const examId = String(req.params.examId);
    const { duration_minutes = 60 } = req.body || {};

const sessionResult = await db.query(`
  INSERT INTO study_sessions (
    user_id,
    room_id,
    topic_id,
    subject_id,
    exam_id,
    mode,
    question_source_mode,
    started_at,
    ended_at,
    summary_json
  )
  SELECT
    $1,
    NULL,
    NULL,
    NULL,
    e.id,
    'exam_simulator',
    'exam',
    now(),
    NULL,
    jsonb_build_object(
      'duration_minutes', $3::int,
      'time_limit_at', now() + make_interval(mins => $3::int)
    )
  FROM exams e
  WHERE e.id = $2
  RETURNING *
`, [userId, examId, duration_minutes]);

    if (!sessionResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Exam not found'
      });
    }

    const session = sessionResult.rows[0];

    const questionsResult = await db.query(`
      SELECT q.*
      FROM questions q
      WHERE q.exam_id = $1
        AND COALESCE(q.is_active, true) = true
      ORDER BY q.year DESC NULLS LAST, RANDOM()
      LIMIT 40
    `, [examId]);

    return res.json({
      success: true,
      data: {
        session,
        questions: questionsResult.rows
      }
    });
  } catch (err) {
    console.error('START_EXAM_SIMULATOR_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/sessions/:sessionId/status', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const sessionId = String(req.params.sessionId);

    const result = await db.query(`
      SELECT *
      FROM study_sessions
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `, [sessionId, userId]);

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    const session = result.rows[0];
    const timeLimitAt = session.summary_json?.time_limit_at || null;

    return res.json({
      success: true,
      data: {
        session,
        time_limit_at: timeLimitAt
      }
    });
  } catch (err) {
    console.error('SESSION_STATUS_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/sessions/:sessionId/finish', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const sessionId = String(req.params.sessionId);

    const result = await db.query(`
      UPDATE study_sessions
      SET ended_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [sessionId, userId]);

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    const answersResult = await db.query(`
      SELECT
        COUNT(*)::int AS total_answered,
        COUNT(*) FILTER (WHERE is_correct = true)::int AS correct_answers
      FROM study_session_answers
      WHERE session_id = $1
    `, [sessionId]);

    const stats = answersResult.rows[0];
    const scorePercent =
      stats.total_answered > 0
        ? Math.round((stats.correct_answers / stats.total_answered) * 100)
        : 0;

    return res.json({
      success: true,
      data: {
        session: result.rows[0],
        stats,
        score_percent: scorePercent
      }
    });
  } catch (err) {
    console.error('FINISH_SESSION_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
