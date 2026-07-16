'use strict';

const db = require('../../../db');

function getPool() {
  if (db.pool && typeof db.pool.connect === 'function') return db.pool;
  if (typeof db.connect === 'function') return db;
  throw new Error('Database pool is not available');
}

function normalizeStatus(status) {
  const allowed = ['submitted', 'under_review', 'verified', 'requires_information', 'declined'];
  return allowed.includes(status) ? status : 'submitted';
}

async function listPendingSchools() {
  const pool = getPool();

  const result = await pool.query(`
    SELECT
      id,
      name AS "schoolName",
      school_type AS "schoolType",
      state,
      lga,
      city,
      official_email AS "officialEmail",
      official_phone AS "officialPhone",
      verification_status AS "verificationStatus",
      created_at AS "createdAt"
    FROM schools
    WHERE verification_status IN ('submitted', 'under_review', 'requires_information')
      AND deleted_at IS NULL
    ORDER BY created_at DESC
  `);

  return result.rows;
}

async function getSchoolById(schoolId) {
  const pool = getPool();

  const [schoolResult, membersResult, examResult, estimateResult, preferenceResult, creditResult, logsResult] =
    await Promise.all([
      pool.query(
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
          verified_by AS "verifiedBy",
          rejection_reason AS "rejectionReason",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM schools
        WHERE id = $1 AND deleted_at IS NULL
        LIMIT 1
        `,
        [schoolId]
      ),

      pool.query(
        `
        SELECT
          id,
          full_name AS "fullName",
          role,
          email,
          phone,
          status,
          created_at AS "createdAt"
        FROM school_members
        WHERE school_id = $1
        ORDER BY created_at ASC
        `,
        [schoolId]
      ),

      pool.query(
        `
        SELECT exam_type AS "examType"
        FROM school_exam_focus
        WHERE school_id = $1
        ORDER BY exam_type ASC
        `,
        [schoolId]
      ),

      pool.query(
        `
        SELECT
          estimated_students AS "estimatedStudents",
          estimated_teachers AS "estimatedTeachers",
          ss3_students AS "ss3Students",
          jamb_candidates AS "jambCandidates",
          expected_launch_date AS "expectedLaunchDate"
        FROM school_estimates
        WHERE school_id = $1
        LIMIT 1
        `,
        [schoolId]
      ),

      pool.query(
        `
        SELECT
          individual_student_subscriptions AS "individualStudentSubscriptions",
          school_sponsored_seats AS "schoolSponsoredSeats",
          interested_in_pilot AS "interestedInPilot",
          interested_in_demo AS "interestedInDemo",
          referral_source AS "referralSource",
          referral_source_other AS "referralSourceOther"
        FROM school_partnership_preferences
        WHERE school_id = $1
        LIMIT 1
        `,
        [schoolId]
      ),

      pool.query(
        `
        SELECT
          COALESCE(SUM(amount), 0) AS "totalCredit"
        FROM school_credit_ledger
        WHERE school_id = $1
        `,
        [schoolId]
      ),

      pool.query(
        `
        SELECT
          id,
          to_status AS "status",
          note,
          created_at AS "createdAt"
        FROM school_verification_logs
        WHERE school_id = $1
        ORDER BY created_at DESC
        `,
        [schoolId]
      ),
    ]);

  if (!schoolResult.rows[0]) return null;

  return {
    ...schoolResult.rows[0],
    members: membersResult.rows,
    examFocus: examResult.rows.map((row) => row.examType),
    estimates: estimateResult.rows[0] || null,
    partnershipPreferences: preferenceResult.rows[0] || null,
    credit: creditResult.rows[0] || { totalCredit: 0 },
    verificationLogs: logsResult.rows,
  };
}

async function updateSchoolStatus({ schoolId, status, note, adminUserId = null }) {
  const pool = getPool();
  const client = await pool.connect();

  const nextStatus = normalizeStatus(status);

  try {
    await client.query('BEGIN');

    const updateResult = await client.query(
      `
      UPDATE schools
      SET
        verification_status = $2,
        verified_at = CASE WHEN $2 = 'verified' THEN NOW() ELSE verified_at END,
        verified_by = CASE WHEN $2 = 'verified' THEN $3 ELSE verified_by END,
        rejection_reason = CASE WHEN $2 = 'declined' THEN $4 ELSE rejection_reason END,
        updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING
        id,
        name AS "schoolName",
        verification_status AS "verificationStatus",
        verified_at AS "verifiedAt"
      `,
      [schoolId, nextStatus, adminUserId, note || null]
    );

    if (!updateResult.rows[0]) {
      const error = new Error('School not found');
      error.statusCode = 404;
      throw error;
    }

    await client.query(
      `
      INSERT INTO school_verification_logs (
        school_id,
        to_status,
        note
      )
      VALUES ($1, $2, $3)
      `,
      [schoolId, nextStatus, note || `School status changed to ${nextStatus}`]
    );

    if (nextStatus === 'verified') {
      await client.query(
        `
        UPDATE school_members
        SET status = 'active',
            updated_at = NOW()
        WHERE school_id = $1
          AND status IN ('invited', 'pending')
        `,
        [schoolId]
      );
    }

    await client.query('COMMIT');

    return updateResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function verifySchool(schoolId, adminUserId = null) {
  return updateSchoolStatus({
    schoolId,
    status: 'verified',
    note: 'School verified by admin',
    adminUserId,
  });
}

async function declineSchool(schoolId, reason) {
  return updateSchoolStatus({
    schoolId,
    status: 'declined',
    note: reason || 'School application declined',
  });
}

async function requestMoreInformation(schoolId, note) {
  return updateSchoolStatus({
    schoolId,
    status: 'requires_information',
    note: note || 'More information requested',
  });
}

module.exports = {
  listPendingSchools,
  getSchoolById,
  updateSchoolStatus,
  verifySchool,
  declineSchool,
  requestMoreInformation,
};
