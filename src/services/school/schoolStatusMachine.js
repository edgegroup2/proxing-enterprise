'use strict';

const db = require('../../../src/db');

const VALID_TRANSITIONS = {
  submitted: ['under_review', 'declined', 'rejected'],
  under_review: ['verified', 'declined', 'rejected', 'more_info_required'],
  more_info_required: ['under_review', 'declined', 'rejected'],
  declined: ['under_review'],
  rejected: ['under_review'],
  verified: [],
  suspended: ['under_review'],
};

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') return db.pool;
  if (typeof db.query === 'function') return db;
  throw new Error('Database pool is not available');
}

function canTransition(fromStatus, toStatus) {
  const allowed = VALID_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

function assertTransition(fromStatus, toStatus) {
  if (!canTransition(fromStatus, toStatus)) {
    const err = new Error(`Cannot transition from ${fromStatus} to ${toStatus}`);
    err.statusCode = 409;
    err.code = 'INVALID_STATE_TRANSITION';
    throw err;
  }
}

async function transitionSchoolStatus({
  schoolId,
  toStatus,
  reason,
  actorUserId = null,
}) {
  if (!schoolId) {
    const err = new Error('schoolId is required');
    err.statusCode = 400;
    err.code = 'SCHOOL_ID_REQUIRED';
    throw err;
  }

  if (!toStatus) {
    const err = new Error('toStatus is required');
    err.statusCode = 400;
    err.code = 'TO_STATUS_REQUIRED';
    throw err;
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `
      SELECT id, verification_status
      FROM schools
      WHERE id = $1
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      [schoolId]
    );

    if (!currentResult.rows.length) {
      const err = new Error('School not found');
      err.statusCode = 404;
      err.code = 'SCHOOL_NOT_FOUND';
      throw err;
    }

    const fromStatus = currentResult.rows[0].verification_status;

    assertTransition(fromStatus, toStatus);

    const updateResult = await client.query(
      `
      UPDATE schools
      SET
        verification_status = $2,
        verified_at = CASE WHEN $2 = 'verified' THEN NOW() ELSE verified_at END,
        verified_by = CASE WHEN $2 = 'verified' THEN $3 ELSE verified_by END,
        rejection_reason = CASE
          WHEN $2 IN ('declined', 'rejected') THEN $4
          ELSE rejection_reason
        END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [schoolId, toStatus, actorUserId, reason || null]
    );

    await client.query(
      `
      INSERT INTO school_verification_logs (
        school_id,
        actor_user_id,
        from_status,
        to_status,
        note
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [schoolId, actorUserId, fromStatus, toStatus, reason || null]
    );

    await client.query('COMMIT');

    return updateResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  VALID_TRANSITIONS,
  canTransition,
  assertTransition,
  transitionSchoolStatus,
};
