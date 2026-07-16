'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * CREATE CHALLENGE
 */
router.post('/create', async (req, res) => {
  try {
    const {
      squad_id,
      host_id,
      exam_type,
      subject,
      limit = 10
    } = req.body || {};

    if (!squad_id || !host_id || !exam_type || !subject) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

const questions = await db.query(`
  SELECT q.id::uuid AS id
  FROM questions q
  WHERE q.exam_type = $1
    AND q.subject_id IN (
      SELECT id
      FROM subjects
      WHERE name = $2
    )
    AND q.is_active = true
  ORDER BY RANDOM()
  LIMIT $3
`, [exam_type, subject, limit]);

    const challenge = await db.query(`
      INSERT INTO squad_challenges (
        squad_id,
        host_id,
        exam_type,
        subject,
        total_questions,
        status
      )
      VALUES ($1, $2, $3, $4, $5, 'waiting')
      RETURNING *
    `, [
      squad_id,
      host_id,
      exam_type,
      subject,
      questions.rows.length
    ]);

    for (let i = 0; i < questions.rows.length; i++) {
await db.query(`
  INSERT INTO squad_challenge_questions (
    challenge_id,
    question_id,
    question_order
  )
  VALUES ($1, $2, $3)
`, [
  challenge.rows[0].id,
  String(questions.rows[i].id),
  i
]);
    }

    return res.json({
      success: true,
      data: {
        challenge: challenge.rows[0],
        question_count: questions.rows.length
      }
    });

  } catch (err) {
    console.error('[CREATE_CHALLENGE_ERROR]', err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * START CHALLENGE
 */
router.post('/:id/start', async (req, res) => {
  try {
    const challengeId = req.params.id;

    const result = await db.query(`
      UPDATE squad_challenges
      SET
        status = 'live',
        started_at = now()
      WHERE id = $1
      RETURNING *
    `, [challengeId]);

    return res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    console.error('[START_CHALLENGE_ERROR]', err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * LIVE CHALLENGES
 */
router.get('/live/:squadId', async (req, res) => {
  try {
    const squadId = req.params.squadId;

    const result = await db.query(`
      SELECT *
      FROM squad_challenges
      WHERE squad_id = $1
        AND status IN ('waiting', 'live')
      ORDER BY created_at DESC
    `, [squadId]);

    return res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error('[LIVE_CHALLENGE_ERROR]', err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * SUBMIT SQUAD CHALLENGE ANSWER
 * POST /api/squad-challenges/:id/answer
 */
router.post('/:id/answer', async (req, res) => {
  try {
    const challengeId = req.params.id;

    const {
      user_id,
      question_id,
      selected_option_id,
      response_time = 0
    } = req.body || {};

    if (!user_id || !question_id || !selected_option_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id, question_id and selected_option_id are required'
      });
    }

    const challenge = await db.query(`
      SELECT *
      FROM squad_challenges
      WHERE id = $1
      LIMIT 1
    `, [challengeId]);

    if (!challenge.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Challenge not found'
      });
    }

    if (challenge.rows[0].status !== 'live' && challenge.rows[0].status !== 'waiting') {
      return res.status(400).json({
        success: false,
        error: 'Challenge is not accepting answers'
      });
    }

    const membership = await db.query(`
      SELECT id
      FROM squad_members
      WHERE squad_id = $1
        AND user_id = $2
      LIMIT 1
    `, [challenge.rows[0].squad_id, user_id]);

    if (!membership.rows.length) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this squad'
      });
    }

    const challengeQuestion = await db.query(`
      SELECT id
      FROM squad_challenge_questions
      WHERE challenge_id = $1
        AND question_id = $2
      LIMIT 1
    `, [challengeId, question_id]);

    if (!challengeQuestion.rows.length) {
      return res.status(400).json({
        success: false,
        error: 'Question does not belong to this challenge'
      });
    }

    const alreadyAnswered = await db.query(`
      SELECT id
      FROM squad_challenge_answers
      WHERE challenge_id = $1
        AND user_id = $2
        AND question_id = $3
      LIMIT 1
    `, [challengeId, user_id, question_id]);

    if (alreadyAnswered.rows.length) {
      return res.status(409).json({
        success: false,
        error: 'Question already answered by this user'
      });
    }

    const option = await db.query(`
      SELECT id, is_correct
      FROM question_options
      WHERE id = $1
        AND question_id = $2
      LIMIT 1
    `, [selected_option_id, question_id]);

    if (!option.rows.length) {
      return res.status(400).json({
        success: false,
        error: 'Selected option does not belong to this question'
      });
    }

    const isCorrect = option.rows[0].is_correct === true;

    const saved = await db.query(`
      INSERT INTO squad_challenge_answers (
        challenge_id,
        user_id,
        question_id,
        selected_option_id,
        is_correct,
        response_time
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      challengeId,
      user_id,
      question_id,
      selected_option_id,
      isCorrect,
      response_time || 0
    ]);

    return res.json({
      success: true,
      data: {
        answer: saved.rows[0],
        is_correct: isCorrect
      }
    });

  } catch (err) {
    console.error('[SQUAD_ANSWER_ERROR]', err);

    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to submit squad answer'
    });
  }
});

/**
 * GET CHALLENGE DETAILS
 * GET /api/squad-challenges/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const challengeId = req.params.id;

    const challenge = await db.query(`
      SELECT *
      FROM squad_challenges
      WHERE id = $1
      LIMIT 1
    `, [challengeId]);

    if (!challenge.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Challenge not found'
      });
    }

    const questions = await db.query(`
      SELECT
        scq.question_order,
        q.id AS question_id,
        q.stem,
        q.explanation,
        q.difficulty,
        q.year,
        q.source,
        t.name AS topic,
        COALESCE(
          json_agg(
            json_build_object(
              'id', qo.id,
              'label', qo.label,
              'text', qo.text
            )
            ORDER BY qo.label
          ) FILTER (WHERE qo.id IS NOT NULL),
          '[]'
        ) AS options
      FROM squad_challenge_questions scq
      JOIN questions q ON q.id = scq.question_id
      LEFT JOIN topics t ON t.id = q.topic_id
      LEFT JOIN question_options qo ON qo.question_id = q.id
      WHERE scq.challenge_id = $1
      GROUP BY
        scq.question_order,
        q.id,
        q.stem,
        q.explanation,
        q.difficulty,
        q.year,
        q.source,
        t.name
      ORDER BY scq.question_order ASC
    `, [challengeId]);

    return res.json({
      success: true,
      data: {
        challenge: challenge.rows[0],
        questions: questions.rows
      }
    });

  } catch (err) {
    console.error('[GET_CHALLENGE_ERROR]', err);

    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch challenge'
    });
  }
});

router.post('/start', async (req, res) => {
  try {
    const { challenge_id } = req.body;

    const existing = await db.query(
      `SELECT * FROM squad_challenges WHERE id = $1`,
      [challenge_id]
    );

    if (!existing.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Challenge not found'
      });
    }

    const challenge = existing.rows[0];

    if (challenge.status !== 'waiting') {
      return res.status(400).json({
        success: false,
        error: 'Challenge already started'
      });
    }

    await db.query(
      `UPDATE squad_challenges
       SET status = 'in_progress',
           started_at = now()
       WHERE id = $1`,
      [challenge_id]
    );

const io = req.app.get('io');

if (io) {
  io.to(`challenge:${challenge_id}`).emit('challenge_started', {
    challenge_id,
    status: 'in_progress',
    started_at: new Date().toISOString()
  });
}

    return res.json({
      success: true,
      message: 'Challenge started'
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/answer', async (req, res) => {
  try {
    const {
      challenge_id,
      user_id,
      question_id,
      selected_option_id,
      response_time = 0
    } = req.body || {};

    if (!challenge_id || !user_id || !question_id || !selected_option_id) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const option = await db.query(`
      SELECT is_correct
      FROM question_options
      WHERE id = $1 AND question_id = $2
      LIMIT 1
    `, [selected_option_id, question_id]);

    if (!option.rows.length) {
      return res.status(400).json({ success: false, error: 'Invalid selected option' });
    }

    const saved = await db.query(`
      INSERT INTO squad_challenge_answers (
        challenge_id,
        user_id,
        question_id,
        selected_option_id,
        is_correct,
        response_time
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      challenge_id,
      user_id,
      question_id,
      selected_option_id,
      option.rows[0].is_correct === true,
      response_time
    ]);

const io = req.app.get('io');

if (io) {
  io.to(`challenge:${challenge_id}`).emit('player_answered', {
    challenge_id,
    user_id,
    question_id,
    is_correct: option.rows[0].is_correct === true,
    response_time
  });

  io.to(`challenge:${challenge_id}`).emit('leaderboard_updated', {
    challenge_id
  });
}

    return res.json({
      success: true,
      data: saved.rows[0]
    });

  } catch (err) {
    console.error('[SQUAD_ANSWER_ERROR]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


router.get('/:id/leaderboard', async (req, res) => {
  try {
    const challengeId = req.params.id;

    const leaderboard = await db.query(`
      SELECT
        user_id,
        COUNT(*)::int AS answered,
        COUNT(*) FILTER (WHERE is_correct = true)::int AS correct,
        COUNT(*) FILTER (WHERE is_correct = false)::int AS wrong,
        COALESCE(AVG(response_time), 0)::numeric(10,2) AS avg_response_time,
        (
          COUNT(*) FILTER (WHERE is_correct = true) * 100
          +
          GREATEST(0, 30 - COALESCE(AVG(response_time), 0))
        )::numeric(10,2) AS score
      FROM squad_challenge_answers
      WHERE challenge_id = $1
      GROUP BY user_id
      ORDER BY score DESC, avg_response_time ASC
    `, [challengeId]);

    return res.json({
      success: true,
      data: leaderboard.rows
    });

  } catch (err) {
    console.error('[SQUAD_LEADERBOARD_ERROR]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/finish', async (req, res) => {
  try {
    const { challenge_id } = req.body || {};

    if (!challenge_id) {
      return res.status(400).json({
        success: false,
        error: 'challenge_id is required'
      });
    }

    const result = await db.query(`
      UPDATE squad_challenges
      SET status = 'completed',
          ended_at = now()
      WHERE id = $1
      RETURNING *
    `, [challenge_id]);

const io = req.app.get('io');

if (io) {
  io.to(`challenge:${challenge_id}`).emit('challenge_finished', {
    challenge_id,
    status: 'completed',
    ended_at: new Date().toISOString()
  });
}

    return res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    console.error('[SQUAD_FINISH_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * SQUAD CHALLENGE RESULTS
 * GET /api/squad-challenges/:id/results
 */
router.get('/:id/results', async (req, res) => {
  try {
    const challengeId = req.params.id;

    const challenge = await db.query(`
      SELECT *
      FROM squad_challenges
      WHERE id = $1
      LIMIT 1
    `, [challengeId]);

    if (!challenge.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Challenge not found'
      });
    }

    const leaderboard = await db.query(`
      SELECT
        a.user_id,
        COUNT(*)::int AS answered,
        COUNT(*) FILTER (WHERE a.is_correct = true)::int AS correct,
        COUNT(*) FILTER (WHERE a.is_correct = false)::int AS wrong,
        COALESCE(AVG(a.response_time), 0)::numeric(10,2) AS avg_response_time,
        COALESCE(SUM(a.response_time), 0)::int AS total_response_time,
        ROUND(
          (
            COUNT(*) FILTER (WHERE a.is_correct = true)::numeric
            / NULLIF(COUNT(*), 0)
          ) * 100,
          2
        ) AS accuracy,
        (
          COUNT(*) FILTER (WHERE a.is_correct = true) * 100
          +
          GREATEST(0, 30 - COALESCE(AVG(a.response_time), 0))
        )::numeric(10,2) AS score
      FROM squad_challenge_answers a
      WHERE a.challenge_id = $1
      GROUP BY a.user_id
      ORDER BY score DESC, avg_response_time ASC
    `, [challengeId]);

    const answers = await db.query(`
      SELECT
        a.id AS answer_id,
        a.user_id,
        a.question_id,
        q.stem,
        t.name AS topic,
        a.selected_option_id,
        so.label AS selected_label,
        so.text AS selected_text,
        co.id AS correct_option_id,
        co.label AS correct_label,
        co.text AS correct_text,
        a.is_correct,
        a.response_time,
        a.created_at
      FROM squad_challenge_answers a
      JOIN questions q ON q.id = a.question_id
      LEFT JOIN topics t ON t.id = q.topic_id
      LEFT JOIN question_options so ON so.id = a.selected_option_id
      LEFT JOIN question_options co
        ON co.question_id = q.id
       AND co.is_correct = true
      WHERE a.challenge_id = $1
      ORDER BY a.created_at ASC
    `, [challengeId]);

    const topicBreakdown = await db.query(`
      SELECT
        COALESCE(t.name, 'Unknown') AS topic,
        COUNT(a.id)::int AS answered,
        COUNT(a.id) FILTER (WHERE a.is_correct = true)::int AS correct,
        COUNT(a.id) FILTER (WHERE a.is_correct = false)::int AS wrong,
        ROUND(
          (
            COUNT(a.id) FILTER (WHERE a.is_correct = true)::numeric
            / NULLIF(COUNT(a.id), 0)
          ) * 100,
          2
        ) AS accuracy,
        COALESCE(AVG(a.response_time), 0)::numeric(10,2) AS avg_response_time
      FROM squad_challenge_answers a
      JOIN questions q ON q.id = a.question_id
      LEFT JOIN topics t ON t.id = q.topic_id
      WHERE a.challenge_id = $1
      GROUP BY t.name
      ORDER BY accuracy ASC NULLS FIRST, answered DESC
    `, [challengeId]);

    return res.json({
      success: true,
      data: {
        challenge: challenge.rows[0],
        leaderboard: leaderboard.rows,
        answers: answers.rows,
        topic_breakdown: topicBreakdown.rows
      }
    });

  } catch (err) {
    console.error('[SQUAD_RESULTS_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch squad challenge results'
    });
  }
});

module.exports = router;
