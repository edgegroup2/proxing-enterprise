const express = require('express');
const { runPublisherOnce } = require('../jobs/questionPublisherCron');
const db = require('../db');
const {
  seedDraftsForAllExams,
  publishQueuedQuestions
} = require('../services/educationContentEngine');
const { requireAuth } = require('../middleware/auth');
const {
  parseGeneratedQuestions,
  insertQuestionDrafts
} = require('../services/aiQuestionGenerator');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }
  next();
}

/**
 * POST /api/learn-admin/ai-generate
 * Body:
 * {
 *   "subject_id": "...",
 *   "topic_id": "...",
 *   "exam_type": "jamb",
 *   "difficulty": 2,
 *   "count": 10
 * }
 */
router.post('/ai-generate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      subject_id,
      topic_id,
      exam_type = 'jamb',
      difficulty = 2,
      count = 10
    } = req.body;

    if (!subject_id || !topic_id) {
      return res.status(400).json({
        success: false,
        error: 'subject_id and topic_id are required'
      });
    }

    const job = await db.query(
      `
      INSERT INTO ai_question_generation_jobs (
        subject_id,
        topic_id,
        exam_type,
        difficulty,
        requested_count,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [subject_id, topic_id, exam_type, difficulty, count, req.user.id]
    );

    return res.status(201).json({
      success: true,
      data: job.rows[0]
    });
  } catch (err) {
    console.error('AI_GENERATE_JOB_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * Temporary direct import endpoint.
 * Lovable can use this after AI output is available.
 */
router.post('/ai-drafts/import', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      subject_id,
      topic_id,
      exam_type,
      prompt,
      ai_model,
      questions
    } = req.body;

    if (!Array.isArray(questions) || !questions.length) {
      return res.status(400).json({
        success: false,
        error: 'questions array is required'
      });
    }

    const drafts = parseGeneratedQuestions(questions, {
      subject_id,
      topic_id,
      exam_type,
      prompt,
      ai_model
    });

    const result = await insertQuestionDrafts(db, drafts);

    return res.json({
      success: true,
      inserted: result.inserted.length,
      duplicates: result.duplicates.length,
      data: result
    });
  } catch (err) {
    console.error('AI_DRAFT_IMPORT_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/drafts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status = 'pending', limit = 50 } = req.query;

    const result = await db.query(
      `
      SELECT
        qd.*,
        s.name AS subject_name,
        t.name AS topic_name
      FROM question_drafts qd
      LEFT JOIN subjects s ON s.id = qd.subject_id
      LEFT JOIN topics t ON t.id = qd.topic_id
      WHERE qd.review_status = $1
      ORDER BY qd.created_at DESC
      LIMIT $2
      `,
      [status, Number(limit)]
    );

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('ADMIN_DRAFTS_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/drafts/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `
      UPDATE question_drafts
      SET
        review_status = 'approved',
        approved_by = $2,
        approved_at = now(),
        updated_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [id, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Draft not found'
      });
    }

    await db.query(
      `
      INSERT INTO question_publish_queue (draft_id, priority, status)
      VALUES ($1, 5, 'queued')
      ON CONFLICT DO NOTHING
      `,
      [id]
    );

    return res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (err) {
    console.error('APPROVE_DRAFT_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/content/seed-all', requireAdmin, async (req, res) => {
  try {
    const seeded = await seedDraftsForAllExams({ autoQueue: true });
    const published = await publishQueuedQuestions({ limit: 100 });

    return res.json({
      success: true,
      seeded,
      published
    });
  } catch (err) {
    console.error('[LEARN_ADMIN_SEED_ALL_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/content/publish-queued', requireAdmin, async (req, res) => {
  try {
    const limit = Number(req.body?.limit || 100);
    const result = await publishQueuedQuestions({ limit });

    return res.json({
      success: true,
      result
    });
  } catch (err) {
    console.error('[LEARN_ADMIN_PUBLISH_QUEUED_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/drafts/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const result = await db.query(
      `
      UPDATE question_drafts
      SET
        review_status = 'rejected',
        publish_status = 'rejected',
        updated_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    return res.json({
      success: true,
      reason: reason || null,
      data: result.rows[0] || null
    });
  } catch (err) {
    console.error('REJECT_DRAFT_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/coverage', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        tc.*,
        t.name AS topic_name,
        s.name AS subject_name,
        s.exam_type
      FROM topic_coverage tc
      JOIN topics t ON t.id = tc.topic_id
      LEFT JOIN subjects s ON s.id = t.subject_id
      ORDER BY tc.is_ready ASC, tc.coverage_score ASC, tc.last_updated DESC
    `);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('COVERAGE_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/publish/process', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.query(`SELECT process_publish_queue()`);

    return res.json({
      success: true,
      message: 'Publish queue processed'
    });
  } catch (err) {
    console.error('PUBLISH_PROCESS_ERROR', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
