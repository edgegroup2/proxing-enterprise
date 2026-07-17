'use strict';

const db = require('../../db');

const STATUS_ALIASES = Object.freeze({
  draft: 'draft',
  submitted: 'submitted',
  under_review: 'under_review',

  more_info_required: 'requires_information',
  requires_information: 'requires_information',

  approved: 'verified',
  verified: 'verified',

  rejected: 'declined',
  declined: 'declined',

  suspended: 'suspended',
});

const VALID_TRANSITIONS = Object.freeze({
  draft: ['submitted'],
  submitted: ['under_review', 'declined'],
  under_review: [
    'verified',
    'declined',
    'requires_information',
    'suspended',
  ],
  requires_information: ['under_review', 'declined'],
  declined: ['under_review'],
  verified: ['suspended'],
  suspended: ['under_review', 'verified'],
});

function getPool() {
  if (
    db.pool &&
    typeof db.pool.connect === 'function' &&
    typeof db.pool.query === 'function'
  ) {
    return db.pool;
  }

  if (
    typeof db.connect === 'function' &&
    typeof db.query === 'function'
  ) {
    return db;
  }

  throw new Error('Database pool is not available');
}

function createHttpError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeSchoolStatus(status) {
  const rawStatus = String(status || '')
    .trim()
    .toLowerCase();

  const normalizedStatus = STATUS_ALIASES[rawStatus];

  if (!normalizedStatus) {
    throw createHttpError(
      `Unsupported school status: ${rawStatus || '(empty)'}`,
      400,
      'INVALID_SCHOOL_STATUS',
    );
  }

  return normalizedStatus;
}

function toApiSchoolStatus(status) {
  const normalizedStatus = normalizeSchoolStatus(status);

  if (normalizedStatus === 'verified') return 'approved';
  if (normalizedStatus === 'requires_information') {
    return 'more_info_required';
  }
  if (normalizedStatus === 'declined') return 'rejected';

  return normalizedStatus;
}

function canTransition(fromStatus, toStatus) {
  try {
    const normalizedFrom = normalizeSchoolStatus(fromStatus);
    const normalizedTo = normalizeSchoolStatus(toStatus);

    if (normalizedFrom === normalizedTo) {
      return true;
    }

    const allowedTransitions =
      VALID_TRANSITIONS[normalizedFrom] || [];

    return allowedTransitions.includes(normalizedTo);
  } catch {
    return false;
  }
}

function assertTransition(fromStatus, toStatus) {
  const normalizedFrom = normalizeSchoolStatus(fromStatus);
  const normalizedTo = normalizeSchoolStatus(toStatus);

  if (!canTransition(normalizedFrom, normalizedTo)) {
    throw createHttpError(
      `Cannot transition school from ${normalizedFrom} to ${normalizedTo}`,
      409,
      'INVALID_STATE_TRANSITION',
    );
  }
}

async function activatePrimaryRepresentative(client, school) {
  const candidateResult = await client.query(
    `
      SELECT
        sm.id,
        sm.status,
        sm.is_primary
      FROM school_members sm
      WHERE sm.school_id = $1
      ORDER BY
        CASE WHEN sm.is_primary = true THEN 0 ELSE 1 END,
        CASE
          WHEN LOWER(COALESCE(sm.email, '')) =
               LOWER(COALESCE($2, ''))
          THEN 0
          ELSE 1
        END,
        CASE
          WHEN regexp_replace(COALESCE(sm.phone, ''), '[^0-9]', '', 'g') =
               regexp_replace(COALESCE($3, ''), '[^0-9]', '', 'g')
          THEN 0
          ELSE 1
        END,
        sm.created_at ASC,
        sm.id ASC
      LIMIT 1
      FOR UPDATE
    `,
    [
      school.id,
      school.official_email || null,
      school.official_phone || null,
    ],
  );

  let member;

  if (candidateResult.rows.length > 0) {
    const candidate = candidateResult.rows[0];

    await client.query(
      `
        UPDATE school_members
        SET
          is_primary = false,
          updated_at = NOW()
        WHERE school_id = $1
          AND is_primary = true
          AND id <> $2
      `,
      [school.id, candidate.id],
    );

    const activatedResult = await client.query(
      `
        UPDATE school_members
        SET
          status = 'active',
          is_primary = true,
          activated_at = COALESCE(activated_at, NOW()),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [candidate.id],
    );

    member = activatedResult.rows[0];
  } else {
    const insertedResult = await client.query(
      `
        INSERT INTO school_members (
          school_id,
          full_name,
          email,
          phone,
          role,
          status,
          is_primary,
          activated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'admin',
          'active',
          true,
          NOW()
        )
        RETURNING *
      `,
      [
        school.id,
        `${school.name || 'School'} Representative`,
        school.official_email || null,
        school.official_phone || null,
      ],
    );

    member = insertedResult.rows[0];
  }

  return member;
}

async function writeStatusAuditEvent(client, {
  schoolId,
  actorUserId,
  fromStatus,
  toStatus,
  internalNote,
  schoolMessage,
}) {
  const generalNote =
    internalNote ||
    schoolMessage ||
    `School status changed from ${fromStatus} to ${toStatus}`;

  await client.query(
    `
      INSERT INTO school_application_events (
        school_id,
        actor_user_id,
        from_status,
        to_status,
        note,
        event_type,
        internal_note,
        message_to_school
      )
      VALUES ($1, $2, $3, $4, $5, 'status_change', $6, $7)
    `,
    [
      schoolId,
      actorUserId || null,
      fromStatus,
      toStatus,
      generalNote,
      internalNote || null,
      schoolMessage || null,
    ],
  );

  const legacyTableResult = await client.query(
    `
      SELECT to_regclass(
        'public.school_verification_logs'
      ) AS table_name
    `,
  );

  if (legacyTableResult.rows[0]?.table_name) {
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
      [
        schoolId,
        actorUserId || null,
        fromStatus,
        toStatus,
        generalNote,
      ],
    );
  }
}

async function transitionSchoolStatus({
  schoolId,
  toStatus,
  reason = null,
  internalNote = null,
  schoolMessage = null,
  actorUserId = null,
}) {
  if (!schoolId) {
    throw createHttpError(
      'schoolId is required',
      400,
      'SCHOOL_ID_REQUIRED',
    );
  }

  if (!toStatus) {
    throw createHttpError(
      'toStatus is required',
      400,
      'TO_STATUS_REQUIRED',
    );
  }

  const normalizedToStatus = normalizeSchoolStatus(toStatus);
  const normalizedInternalNote =
    String(internalNote || reason || '').trim() || null;
  const normalizedSchoolMessage =
    String(schoolMessage || '').trim() || null;

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `
        SELECT
          id,
          name,
          official_email,
          official_phone,
          verification_status,
          verified_at,
          verified_by
        FROM schools
        WHERE id = $1
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [schoolId],
    );

    if (!currentResult.rows.length) {
      throw createHttpError(
        'School not found',
        404,
        'SCHOOL_NOT_FOUND',
      );
    }

    const currentSchool = currentResult.rows[0];
    const normalizedFromStatus = normalizeSchoolStatus(
      currentSchool.verification_status,
    );

    assertTransition(
      normalizedFromStatus,
      normalizedToStatus,
    );

    /*
     * Idempotent re-approval:
     * ensure the representative remains activated without creating
     * another status event.
     */
    if (normalizedFromStatus === normalizedToStatus) {
      let member = null;

      if (normalizedToStatus === 'verified') {
        member = await activatePrimaryRepresentative(
          client,
          currentSchool,
        );
      }

      await client.query('COMMIT');

      return {
        ...currentSchool,
        verification_status: normalizedToStatus,
        api_status: toApiSchoolStatus(normalizedToStatus),
        primary_member: member,
        unchanged: true,
      };
    }

    const updateResult = await client.query(
      `
        UPDATE schools
        SET
          verification_status = $2,

          verified_at = CASE
            WHEN $2 = 'verified'
              THEN COALESCE(verified_at, NOW())
            ELSE verified_at
          END,

          verified_by = CASE
            WHEN $2 = 'verified'
              THEN COALESCE($3, verified_by)
            ELSE verified_by
          END,

          rejection_reason = CASE
            WHEN $2 = 'declined'
              THEN COALESCE($4, rejection_reason)
            WHEN $2 IN (
              'under_review',
              'requires_information',
              'verified'
            )
              THEN NULL
            ELSE rejection_reason
          END,

          updated_at = NOW()
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING *
      `,
      [
        schoolId,
        normalizedToStatus,
        actorUserId || null,
        normalizedInternalNote ||
          normalizedSchoolMessage ||
          null,
      ],
    );

    const updatedSchool = updateResult.rows[0];
    let primaryMember = null;

    if (normalizedToStatus === 'verified') {
      primaryMember = await activatePrimaryRepresentative(
        client,
        updatedSchool,
      );
    }

    await writeStatusAuditEvent(client, {
      schoolId,
      actorUserId,
      fromStatus: normalizedFromStatus,
      toStatus: normalizedToStatus,
      internalNote: normalizedInternalNote,
      schoolMessage: normalizedSchoolMessage,
    });

    await client.query('COMMIT');

    return {
      ...updatedSchool,
      api_status: toApiSchoolStatus(normalizedToStatus),
      primary_member: primaryMember,
      unchanged: false,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  STATUS_ALIASES,
  VALID_TRANSITIONS,
  normalizeSchoolStatus,
  toApiSchoolStatus,
  canTransition,
  assertTransition,
  transitionSchoolStatus,
};
