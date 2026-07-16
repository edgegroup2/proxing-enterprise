'use strict';

const express = require('express');
const db = require('../db');
const { validate: isUUID } = require('uuid');
const { hasPremiumAccess } = require('../services/subscription/access');

const router = express.Router();

function requireUser(req, res, next) {
  req.user = req.user || { id: req.headers['x-user-id'] || null };

  if (!req.user.id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  next();
}

router.get('/languages', async (req, res) => {
  const result = await db.query(`
    SELECT
      l.id,
      l.code,
      l.name,
      l.native_name,
      COUNT(DISTINCT t.id)::int AS topic_count,
      COUNT(DISTINCT les.id)::int AS lesson_count
    FROM culture_languages l
    LEFT JOIN culture_topics t ON t.language_id = l.id AND t.is_active = true
    LEFT JOIN culture_lessons les ON les.topic_id = t.id AND les.is_active = true
    WHERE l.is_active = true
    GROUP BY l.id
    ORDER BY l.name ASC
  `);

  res.json({ languages: result.rows });
});

router.get('/languages/:code/topics', async (req, res) => {
  const { code } = req.params;

  const result = await db.query(
    `
    SELECT
      t.id,
      t.title,
      t.slug,
      t.description,
      t.level,
      COUNT(l.id)::int AS lesson_count
    FROM culture_topics t
    JOIN culture_languages lang ON lang.id = t.language_id
    LEFT JOIN culture_lessons l ON l.topic_id = t.id AND l.is_active = true
    WHERE lang.code = $1
      AND t.is_active = true
    GROUP BY t.id
    ORDER BY t.sort_order ASC, t.title ASC
    `,
    [code]
  );

  res.json({ topics: result.rows });
});

router.get('/topics/:topicId/lessons', async (req, res) => {
  const { topicId } = req.params;

  if (!isUUID(topicId)) {
    return res.status(400).json({
      success: false,
      error: 'invalid topic id'
    });
  }

  const result = await db.query(
    `
    SELECT
      id,
      title,
      lesson_type,
      estimated_minutes,
      is_premium
    FROM culture_lessons
    WHERE topic_id = $1
      AND is_active = true
    ORDER BY sort_order ASC, title ASC
    `,
    [topicId]
  );

  res.json({ lessons: result.rows });
});

router.get('/lessons/:lessonId', requireUser, async (req, res) => {
  const { lessonId } = req.params;

  const lesson = await db.query(
    `
    SELECT
      l.id,
      l.title,
      l.lesson_type,
      l.estimated_minutes,
      l.is_premium,
      t.title AS topic_title,
      lang.code AS language_code,
      lang.name AS language_name
    FROM culture_lessons l
    JOIN culture_topics t ON t.id = l.topic_id
    JOIN culture_languages lang ON lang.id = t.language_id
    WHERE l.id = $1
    `,
    [lessonId]
  );

if (!lesson.rows.length) {
  return res.status(404).json({ error: 'Lesson not found' });
}

const lessonRow = lesson.rows[0];

if (lessonRow.is_premium) {
  const hasAccess = await hasPremiumAccess(req.user.id, 'culture-premium');

  if (!hasAccess) {
    return res.status(402).json({
      success: false,
      error: 'premium_required',
      feature: 'culture-premium',
      message: 'Upgrade to unlock this premium lesson.'
    });
  }
}

  const items = await db.query(
    `
    SELECT
      id,
      item_type,
      prompt,
      native_text,
      translation,
      pronunciation,
      image_url,
      audio_url,
      options,
      answer,
      explanation
    FROM culture_lesson_items
    WHERE lesson_id = $1
    ORDER BY sort_order ASC
    `,
    [lessonId]
  );

  res.json({
    lesson: lesson.rows[0],
    items: items.rows,
  });
});

router.post('/lessons/:lessonId/complete', requireUser, async (req, res) => {
  const { lessonId } = req.params;
  const userId = req.user.id;
  const score = Number(req.body.score || 0);
  const xp = Number(req.body.xp || 10);

  const result = await db.query(
    `
    INSERT INTO culture_progress (
      user_id,
      lesson_id,
      completed,
      score,
      xp,
      completed_at,
      last_seen_at
    )
    VALUES ($1, $2, true, $3, $4, NOW(), NOW())
    ON CONFLICT (user_id, lesson_id)
    DO UPDATE SET
      completed = true,
      score = GREATEST(culture_progress.score, EXCLUDED.score),
      xp = GREATEST(culture_progress.xp, EXCLUDED.xp),
      completed_at = NOW(),
      last_seen_at = NOW()
    RETURNING *
    `,
    [userId, lessonId, score, xp]
  );

  res.json({ progress: result.rows[0] });
});

router.get('/parent/summary', requireUser, async (req, res) => {
  const userId = req.user.id;

  const result = await db.query(
    `
    SELECT
      lang.name AS language,
      lang.code,
      COUNT(cp.id)::int AS completed_lessons,
      COALESCE(SUM(cp.xp), 0)::int AS xp,
      COALESCE(AVG(cp.score), 0)::int AS average_score
    FROM culture_progress cp
    JOIN culture_lessons l ON l.id = cp.lesson_id
    JOIN culture_topics t ON t.id = l.topic_id
    JOIN culture_languages lang ON lang.id = t.language_id
    WHERE cp.user_id = $1
      AND cp.completed = true
    GROUP BY lang.name, lang.code
    ORDER BY lang.name
    `,
    [userId]
  );

  res.json({ summary: result.rows });
});

module.exports = router;
