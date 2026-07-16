'use strict';

const db = require('../../../db');

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') return db.pool;
  if (typeof db.query === 'function') return db;
  throw new Error('Database pool is not available');
}

async function getSchoolDashboard(schoolId) {
  const pool = getPool();

  const schoolResult = await pool.query(
    `
    SELECT
      id,
      name,
      school_type,
      state,
      lga,
      city,
      address,
      official_phone,
      official_email,
      verification_status,
      verified_at,
      created_at
    FROM schools
    WHERE id = $1
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [schoolId]
  );

  if (!schoolResult.rows.length) {
    const err = new Error('School not found');
    err.statusCode = 404;
    throw err;
  }

  const membersResult = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total_members,
      COUNT(*) FILTER (WHERE status = 'active')::int AS active_members,
      COUNT(*) FILTER (WHERE status = 'invited')::int AS invited_members
    FROM school_members
    WHERE school_id = $1
    `,
    [schoolId]
  );

  const examFocusResult = await pool.query(
    `
    SELECT exam_type
    FROM school_exam_focus
    WHERE school_id = $1
    ORDER BY exam_type ASC
    `,
    [schoolId]
  );

  const estimatesResult = await pool.query(
    `
    SELECT
      estimated_students,
      estimated_teachers,
      ss3_students,
      jamb_candidates,
      expected_launch_date
    FROM school_estimates
    WHERE school_id = $1
    LIMIT 1
    `,
    [schoolId]
  );

  const preferencesResult = await pool.query(
    `
    SELECT
      individual_student_subscriptions,
      school_sponsored_seats,
      interested_in_pilot,
      interested_in_demo,
      referral_source,
      referral_source_other
    FROM school_partnership_preferences
    WHERE school_id = $1
    LIMIT 1
    `,
    [schoolId]
  );

  return {
    school: schoolResult.rows[0],
    members: membersResult.rows[0] || {
      total_members: 0,
      active_members: 0,
      invited_members: 0,
    },
    examFocus: examFocusResult.rows.map((row) => row.exam_type),
    estimates: estimatesResult.rows[0] || null,
    partnershipPreferences: preferencesResult.rows[0] || null,

    opportunities: {
      cbtRegistrationRevenue: {
        enabled: true,
        description: 'Schools can register candidates for mock CBT exams and pay per student.',
        example: {
          students: 100,
          feePerStudent: 500,
          estimatedRevenue: 50000,
        },
      },
      schoolSpecificCbt: {
        enabled: true,
        description: 'Schools can create internal tests, upload questions, run CBT, and release results.',
        suggestedMonthlyPrice: 10000,
      },
      academicDevelopmentSupportCredit: {
        enabled: true,
        description: 'Tracks support credit earned from individual student subscriptions.',
      },
    },
  };
}

module.exports = {
  getSchoolDashboard,
};
