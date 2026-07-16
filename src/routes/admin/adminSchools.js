'use strict';

const express = require('express');
const router = express.Router();

const db = require('../../db');

const {
  transitionSchoolStatus,
} = require('../../services/school/schoolStatusMachine');

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') return db.pool;
  if (typeof db.query === 'function') return db;
  throw new Error('Database pool is not available');
}

router.get('/schools', async (req, res) => {
  try {
    const pool = getPool();

    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();

    const params = [];
    let where = `WHERE s.deleted_at IS NULL`;

    if (status) {
      params.push(status);
      where += ` AND s.verification_status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      where += ` AND (
        LOWER(s.name) LIKE $${params.length}
        OR LOWER(COALESCE(s.official_email, '')) LIKE $${params.length}
        OR LOWER(COALESCE(s.official_phone, '')) LIKE $${params.length}
      )`;
    }

    const result = await pool.query(
      `
      SELECT
        s.id,
        s.name,
        s.school_type,
        s.state,
        s.lga,
        s.city,
        s.address,
        s.official_phone,
        s.official_email,
        s.verification_status,
        s.verified_at,
        s.created_at,
        s.updated_at,
        COUNT(sm.id)::int AS member_count
      FROM schools s
      LEFT JOIN school_members sm
        ON sm.school_id = s.id
      ${where}
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT 100
      `,
      params
    );

    return res.json({
      success: true,
      message: 'Schools fetched successfully',
      data: {
        schools: result.rows,
        total: result.rows.length,
      },
    });
  } catch (err) {
    console.error('[ADMIN_SCHOOLS_LIST_ERROR]', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to fetch schools',
      code: 'ADMIN_SCHOOLS_LIST_FAILED',
    });
  }
});

router.post('/schools/:schoolId/begin-review', async (req, res) => {
  try {
    const { schoolId } = req.params;
    const reason = req.body?.reason || 'Review started';

    const result = await transitionSchoolStatus({
      schoolId,
      toStatus: 'under_review',
      reason,
      actorUserId: req.admin?.id || req.user?.id || null,
    });

    res.json({
      success: true,
      message: 'School review started successfully',
      data: { school: result },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to begin school review',
      code: err.code || 'BEGIN_REVIEW_FAILED',
    });
  }
});

router.post('/schools/:schoolId/verify', async (req, res) => {
  try {
    const { schoolId } = req.params;
    const reason = req.body?.reason || 'School verified';

    const result = await transitionSchoolStatus({
      schoolId,
      toStatus: 'verified',
      reason,
      actorUserId: req.admin?.id || req.user?.id || null,
    });

    res.json({
      success: true,
      message: 'School verified successfully',
      data: { school: result },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to verify school',
      code: err.code || 'VERIFY_FAILED',
    });
  }
});

router.post('/schools/:schoolId/reject', async (req, res) => {
  try {
    const { schoolId } = req.params;
    const reason = req.body?.reason || 'School rejected';

    const result = await transitionSchoolStatus({
      schoolId,
      toStatus: 'rejected',
      reason,
      actorUserId: req.admin?.id || req.user?.id || null,
    });

    res.json({
      success: true,
      message: 'School rejected successfully',
      data: { school: result },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to reject school',
      code: err.code || 'REJECT_FAILED',
    });
  }
});

module.exports = router;
