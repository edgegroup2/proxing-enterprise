'use strict';

const express = require('express');
const db = require('../db');
const { requireSchoolAuth } = require('../middlewares/school/schoolAuthMiddleware');

const router = express.Router();

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') return db.pool;
  if (typeof db.query === 'function') return db;
  throw new Error('Database pool is not available');
}

router.get('/auth/application', requireSchoolAuth, async (req, res) => {
  try {
    const schoolId = req.school?.schoolId || req.schoolAuth?.schoolId;

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        message: 'School authentication is required',
        code: 'SCHOOL_AUTH_REQUIRED',
      });
    }

    const pool = getPool();

    const result = await pool.query(
      `
      SELECT
        id,
        name AS "schoolName",
        school_type AS "schoolType",
        state,
        lga,
        city,
        address,
        official_phone AS "officialPhone",
        official_email AS "officialEmail",
        verification_status AS "verificationStatus",
        verified_at AS "verifiedAt",
        rejection_reason AS "reviewerMessage",
        created_at AS "submittedAt",
        updated_at AS "updatedAt"
      FROM schools
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [schoolId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'School application not found',
        code: 'SCHOOL_APPLICATION_NOT_FOUND',
      });
    }

    return res.json({
      success: true,
      message: 'School application fetched successfully',
      data: {
        application: result.rows[0],
      },
    });
  } catch (err) {
    console.error('[SCHOOL_APPLICATION_ERROR]', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to fetch school application',
      code: 'SCHOOL_APPLICATION_FAILED',
    });
  }
});

module.exports = router;
