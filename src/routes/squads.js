'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');

function makeCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * POST /api/squads/create
 */
router.post('/create', async (req, res) => {
  try {
    const {
      creator_id,
      name = 'Study Squad',
      mode = 'revision'
    } = req.body || {};

    if (!creator_id) {
      return res.status(400).json({
        success: false,
        error: 'creator_id is required'
      });
    }

    let code = makeCode();

    const squad = await db.query(`
      INSERT INTO squads (
        creator_id,
        name,
        code,
        mode,
        is_live
      )
      VALUES ($1, $2, $3, $4, true)
      RETURNING *
    `, [creator_id, name, code, mode]);

    await db.query(`
      INSERT INTO squad_members (
        squad_id,
        user_id
      )
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [squad.rows[0].id, creator_id]);

    return res.json({
      success: true,
      data: squad.rows[0]
    });

  } catch (err) {
    console.error('[SQUAD_CREATE_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to create squad'
    });
  }
});

/**
 * POST /api/squads/join
 */
router.post('/join', async (req, res) => {
  try {
    const { user_id, code } = req.body || {};

    if (!user_id || !code) {
      return res.status(400).json({
        success: false,
        error: 'user_id and code are required'
      });
    }

    const squad = await db.query(`
      SELECT *
      FROM squads
      WHERE upper(code) = upper($1)
        AND is_live = true
      LIMIT 1
    `, [code]);

    if (!squad.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Squad not found'
      });
    }

    await db.query(`
      INSERT INTO squad_members (
        squad_id,
        user_id
      )
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [squad.rows[0].id, user_id]);

    return res.json({
      success: true,
      data: squad.rows[0]
    });

  } catch (err) {
    console.error('[SQUAD_JOIN_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to join squad'
    });
  }
});

/**
 * GET /api/squads/live
 */
router.get('/live', async (req, res) => {
  try {
    const squads = await db.query(`
      SELECT
        s.*,
        COUNT(sm.id)::int AS member_count
      FROM squads s
      LEFT JOIN squad_members sm ON sm.squad_id = s.id
      WHERE s.is_live = true
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT 50
    `);

    return res.json({
      success: true,
      data: squads.rows
    });

  } catch (err) {
    console.error('[SQUAD_LIVE_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch live squads'
    });
  }
});

/**
 * GET /api/squads/:id/leaderboard
 */
router.get('/:id/leaderboard', async (req, res) => {
  try {
    const squadId = req.params.id;

    const leaderboard = await db.query(`
      SELECT
        sm.user_id,
        COUNT(es.id)::int AS sessions,
        COALESCE(AVG(es.score_percent), 0)::numeric(5,2) AS average_score,
        COALESCE(MAX(es.score_percent), 0)::numeric(5,2) AS best_score,
        COALESCE(SUM(es.correct_answers), 0)::int AS total_correct,
        COALESCE(SUM(es.total_questions), 0)::int AS total_questions
      FROM squad_members sm
      LEFT JOIN exam_sessions es
        ON es.student_id = sm.user_id
       AND es.status = 'completed'
      WHERE sm.squad_id = $1
      GROUP BY sm.user_id
      ORDER BY average_score DESC, total_correct DESC
    `, [squadId]);

    return res.json({
      success: true,
      data: leaderboard.rows
    });

  } catch (err) {
    console.error('[SQUAD_LEADERBOARD_ERROR]', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch leaderboard'
    });
  }
});

module.exports = router;
