const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

router.get('/due', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await db.query(
      `
      SELECT
        rq.id AS review_id,
        rq.source_table,
        rq.source_question_id,
        rq.question_id,
        rq.subject,
        rq.exam_type,
        rq.topic_id,
        rq.topic_name,
        rq.reason,
        rq.interval_days,
        rq.repetitions,
        rq.due_at,

        COALESCE(q.stem, q.question, pq.question) AS question,
        COALESCE(q.explanation, pq.explanation) AS explanation,
        COALESCE(correct_opt.text, pq.answer) AS answer,

CASE
    WHEN rq.source_table = 'past_questions' THEN
        COALESCE(
            pq.options,
            '[]'::jsonb
        )

    ELSE
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'id', COALESCE(qo.id::text, qo.label),
                    'label', qo.label,
                    'text', qo.text
                )
                ORDER BY qo.label
            ) FILTER (
                WHERE qo.id IS NOT NULL
            ),
            '[]'::jsonb
        )
END AS options

      FROM student_review_queue rq

      LEFT JOIN questions q
        ON rq.source_table = 'questions'
       AND q.id = COALESCE(rq.question_id, rq.source_question_id)

      LEFT JOIN past_questions pq
        ON rq.source_table = 'past_questions'
       AND pq.id = rq.source_question_id

      LEFT JOIN question_options qo
        ON q.id = qo.question_id

      LEFT JOIN question_options correct_opt
        ON q.id = correct_opt.question_id
       AND correct_opt.is_correct = true

      WHERE rq.user_id = $1
        AND rq.status = 'due'
        AND rq.due_at <= now()

GROUP BY
rq.id,
rq.source_table,
q.id,
pq.id,
pq.options,
correct_opt.text

      ORDER BY rq.due_at ASC
      LIMIT 20
      `,
      [userId]
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[REVIEWS_DUE_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: 'Could not load reviews',
    });
  }
});

router.post('/:reviewId/submit', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { reviewId } = req.params;
    const { selectedAnswer, responseTime } = req.body || {};

    const reviewResult = await db.query(
      `
      SELECT
        rq.*,
        COALESCE(qo.text, pq.answer) AS correct_answer
      FROM student_review_queue rq
      LEFT JOIN questions q
        ON rq.source_table = 'questions'
       AND q.id = COALESCE(rq.question_id, rq.source_question_id)
      LEFT JOIN question_options qo
        ON q.id = qo.question_id
       AND qo.is_correct = true
      LEFT JOIN past_questions pq
        ON rq.source_table = 'past_questions'
       AND pq.id = rq.source_question_id
      WHERE rq.id = $1
        AND rq.user_id = $2
      LIMIT 1
      `,
      [reviewId, userId]
    );

    if (!reviewResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Review not found',
      });
    }

    const review = reviewResult.rows[0];

    const norm = (v) =>
      String(v ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

    const isCorrect = norm(selectedAnswer) === norm(review.correct_answer);

    const nextInterval = isCorrect
      ? Math.min(Number(review.interval_days || 1) * 2, 30)
      : 1;

    const repetitions = isCorrect
      ? Number(review.repetitions || 0) + 1
      : 0;

    const nextDueSql = isCorrect
      ? `now() + ($3::int * interval '1 day')`
      : `now() + interval '1 day'`;

    await db.query(
      `
      UPDATE student_review_queue
      SET
        last_is_correct = $4,
        last_response_time = $5,
        interval_days = $3,
        repetitions = $6,
        due_at = ${nextDueSql},
        status = 'due',
        updated_at = now()
      WHERE id = $1
        AND user_id = $2
      `,
      [
        reviewId,
        userId,
        nextInterval,
        isCorrect,
        Number(responseTime || 0),
        repetitions,
      ]
    );

    return res.json({
      success: true,
      data: {
        reviewId,
        isCorrect,
        correctAnswer: review.correct_answer,
        nextInterval,
        repetitions,
      },
    });
  } catch (err) {
    console.error('[REVIEWS_SUBMIT_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: 'Could not submit review answer',
    });
  }
});

module.exports = router;
