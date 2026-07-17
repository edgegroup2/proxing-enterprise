'use strict';

const db = require('../../db');

const ROLE_MAP = {
  Principal: 'principal',
  principal: 'principal',
  'Vice Principal': 'admin',
  'Head Teacher': 'admin',
  'Admin / Bursar': 'admin',
  'Admin/Bursar': 'admin',
  'ICT Coordinator': 'admin',
  Other: 'admin',
};

function getPool() {
  if (db.pool && typeof db.pool.connect === 'function') return db.pool;
  if (typeof db.connect === 'function') return db;
  throw new Error('Database pool is not available');
}

function hasPreference(payload, word) {
  const list = Array.isArray(payload.rolloutPreferences) ? payload.rolloutPreferences : [];
  return list.some((item) => String(item).toLowerCase().includes(word.toLowerCase()));
}


function safeNullableInt(value) {
  const text = value === undefined || value === null
    ? ''
    : String(value).trim();

  if (!text) return null;

  const match = text.replace(/,/g, '').match(/\d+/);

  if (!match) return null;

  const parsed = Number(match[0]);

  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function hasColumn(client, table, column) {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [table, column]
  );

  return result.rowCount > 0;
}

async function registerSchool(payload) {
  const pool = getPool();
  const client = await pool.connect();

  const memberRole = ROLE_MAP[payload.contactRole || payload.representativeRole] || 'admin';

const contactName =
  payload.contactName ?? payload.representativeName;

const contactEmail =
  payload.contactEmail ?? payload.representativeEmail;

const contactPhone =
  payload.contactPhone ?? payload.representativePhone;

const contactRole =
  payload.contactRole ?? payload.representativeRole;

  try {
    await client.query('BEGIN');

    const schoolResult = await client.query(
      `
      INSERT INTO schools (
        name,
        school_type,
        state,
        lga,
        city,
        address,
        official_phone,
        official_email,
        verification_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted')
      RETURNING *
      `,
      [
        payload.schoolName,
        payload.schoolType,
        payload.state,
        payload.lga,
        payload.city,
        payload.schoolAddress,
        payload.officialPhone,
        payload.officialEmail,
      ]
    );

    const school = schoolResult.rows[0];

    await client.query(
      `
      INSERT INTO school_members (
        school_id,
        full_name,
        role,
        email,
        phone,
        status
      )
      VALUES ($1,$2,$3,$4,$5,'invited')
      `,
      [
        school.id,
        (payload.contactName || payload.representativeName),
        memberRole,
        (payload.contactEmail || payload.representativeEmail),
        (payload.contactPhone || payload.representativePhone),
      ]
    );

    for (const exam of payload.examFocus || []) {
      await client.query(
        `
        INSERT INTO school_exam_focus (
          school_id,
          exam_type
        )
        VALUES ($1,$2)
        ON CONFLICT DO NOTHING
        `,
        [school.id, exam]
      );
    }

    await client.query(
      `
        INSERT INTO school_estimates (
          school_id,
          estimated_students,
          estimated_teachers,
          ss3_students,
          jamb_candidates,
          expected_launch_date
        )
        VALUES ($1, COALESCE($2, 0), $3, $4, $5, $6)
      `,
      [
        school.id,
        safeNullableInt(payload.estimatedStudents),
        safeNullableInt(
          payload.numberOfTeachers ?? payload.estimatedTeachers
        ),
        safeNullableInt(payload.ss3Students),
        safeNullableInt(payload.jambCandidates),
        payload.expectedLaunchDate || null,
      ]
    );


    await client.query(
      `
      INSERT INTO school_partnership_preferences (
        school_id,
        individual_student_subscriptions,
        school_sponsored_seats,
        interested_in_pilot,
        interested_in_demo,
        referral_source,
        referral_source_other
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        school.id,
        hasPreference(payload, 'individual'),
        hasPreference(payload, 'school-sponsored') || hasPreference(payload, 'school sponsored'),
        hasPreference(payload, 'pilot'),
        hasPreference(payload, 'demo') || hasPreference(payload, 'demonstration'),
        payload.referralSource || null,
        payload.referralNote || payload.referralSourceOther || null,
      ]
    );

    const logsHasFromStatus = await hasColumn(client, 'school_verification_logs', 'from_status');
    const logsHasToStatus = await hasColumn(client, 'school_verification_logs', 'to_status');

    if (logsHasFromStatus && logsHasToStatus) {
      await client.query(
        `
        INSERT INTO school_verification_logs (
          school_id,
          from_status,
          to_status,
          note
        )
        VALUES ($1, NULL, 'submitted', 'School registration submitted')
        `,
        [school.id]
      );
    }

    await client.query('COMMIT');

    return {
      id: school.id,
      schoolName: school.name,
      status: school.verification_status,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { registerSchool };
