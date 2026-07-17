'use strict';

const db = require('../../../db');

const LINK_MANAGER_ROLES = new Set([
  'principal',
  'admin',
]);

function clean(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function normalizeRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function serviceError(
  message,
  code,
  statusCode
) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function getPool(overridePool) {
  if (
    overridePool &&
    typeof overridePool.connect ===
      'function'
  ) {
    return overridePool;
  }

  if (
    db?.pool &&
    typeof db.pool.connect === 'function'
  ) {
    return db.pool;
  }

  if (
    db &&
    typeof db.connect === 'function'
  ) {
    return db;
  }

  throw serviceError(
    'Database connection is unavailable',
    'SCHOOL_STUDENT_IDENTITY_DATABASE_UNAVAILABLE',
    503
  );
}

function requireIdentity(identity = {}) {
  const schoolId = clean(
    identity.schoolId ||
    identity.school_id
  );

  const memberId = clean(
    identity.memberId ||
    identity.member_id
  );

  const userId = clean(
    identity.userId ||
    identity.user_id ||
    identity.id
  );

  if (!schoolId || !memberId || !userId) {
    throw serviceError(
      'Complete school-user-member authentication is required',
      'SCHOOL_STUDENT_IDENTITY_AUTH_REQUIRED',
      401
    );
  }

  return {
    schoolId,
    memberId,
    userId,
  };
}

function mapStudent(row) {
  return {
    id: String(row.id),
    schoolId: String(row.school_id),
    memberId: row.member_id
      ? String(row.member_id)
      : null,
    admissionNumber:
      row.admission_number || null,
    firstName: row.first_name,
    middleName: row.middle_name || null,
    lastName: row.last_name,
    status: row.status,
    memberLinkedAt:
      row.member_linked_at || null,
    memberLinkedByMemberId:
      row.member_linked_by_member_id
        ? String(
            row.member_linked_by_member_id
          )
        : null,
  };
}

async function linkStudentMember(
  identity,
  studentIdInput,
  targetMemberIdInput,
  options = {}
) {
  const {
    schoolId,
    memberId: actorMemberId,
    userId: actorUserId,
  } = requireIdentity(identity);

  const studentId = clean(studentIdInput);
  const targetMemberId = clean(
    targetMemberIdInput
  );

  if (!studentId) {
    throw serviceError(
      'Student ID is required',
      'SCHOOL_STUDENT_ID_REQUIRED',
      400
    );
  }

  if (!targetMemberId) {
    throw serviceError(
      'Student member ID is required',
      'SCHOOL_STUDENT_MEMBER_ID_REQUIRED',
      400
    );
  }

  const suppliedClient =
    options.client &&
    typeof options.client.query ===
      'function'
      ? options.client
      : null;

  const pool = suppliedClient
    ? null
    : getPool(options.pool);

  const client = suppliedClient ||
    await pool.connect();

  const releaseClient = !suppliedClient;

  try {
    await client.query('BEGIN');

    const actorResult =
      await client.query(
        `
          SELECT
            actor.id,
            actor.user_id,
            actor.role,
            actor.status
          FROM school_members actor
          WHERE actor.id = $1
            AND actor.school_id = $2
            AND actor.user_id = $3
          LIMIT 1
          FOR UPDATE
        `,
        [
          actorMemberId,
          schoolId,
          actorUserId,
        ]
      );

    const actor =
      actorResult.rows?.[0];

    if (
      !actor ||
      actor.status !== 'active'
    ) {
      throw serviceError(
        'Active school administrator membership is required',
        'SCHOOL_STUDENT_LINK_ACTOR_FORBIDDEN',
        403
      );
    }

    const actorRole =
      normalizeRole(actor.role);

    if (
      !LINK_MANAGER_ROLES.has(
        actorRole
      )
    ) {
      throw serviceError(
        'Only a principal or administrator may link a student account',
        'SCHOOL_STUDENT_LINK_ROLE_FORBIDDEN',
        403
      );
    }

    const studentResult =
      await client.query(
        `
          SELECT
            student.id,
            student.school_id,
            student.member_id,
            student.admission_number,
            student.first_name,
            student.middle_name,
            student.last_name,
            student.status,
            student.member_linked_at,
            student.member_linked_by_member_id
          FROM school_students student
          WHERE student.id = $1
            AND student.school_id = $2
            AND student.deleted_at
              IS NULL
          LIMIT 1
          FOR UPDATE
        `,
        [
          studentId,
          schoolId,
        ]
      );

    const student =
      studentResult.rows?.[0];

    if (!student) {
      throw serviceError(
        'Student record was not found',
        'SCHOOL_STUDENT_NOT_FOUND',
        404
      );
    }

    if (student.status !== 'active') {
      throw serviceError(
        'Only an active student record may be linked',
        'SCHOOL_STUDENT_NOT_ACTIVE',
        409
      );
    }

    const targetResult =
      await client.query(
        `
          SELECT
            target.id,
            target.school_id,
            target.user_id,
            target.role,
            target.status
          FROM school_members target
          WHERE target.id = $1
            AND target.school_id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [
          targetMemberId,
          schoolId,
        ]
      );

    const target =
      targetResult.rows?.[0];

    if (!target) {
      throw serviceError(
        'Student school-member account was not found',
        'SCHOOL_STUDENT_MEMBER_NOT_FOUND',
        404
      );
    }

    if (
      normalizeRole(target.role) !==
      'student'
    ) {
      throw serviceError(
        'The selected school member must have the student role',
        'SCHOOL_STUDENT_MEMBER_ROLE_INVALID',
        409
      );
    }

    if (target.status !== 'active') {
      throw serviceError(
        'The selected student membership is not active',
        'SCHOOL_STUDENT_MEMBER_NOT_ACTIVE',
        409
      );
    }

    if (!target.user_id) {
      throw serviceError(
        'The selected student membership is not connected to a user account',
        'SCHOOL_STUDENT_MEMBER_ACCOUNT_NOT_LINKED',
        409
      );
    }

    if (
      student.member_id &&
      String(student.member_id) !==
        String(targetMemberId)
    ) {
      throw serviceError(
        'This student record is already linked to another school member',
        'SCHOOL_STUDENT_ALREADY_LINKED',
        409
      );
    }

    if (
      student.member_id &&
      String(student.member_id) ===
        String(targetMemberId)
    ) {
      await client.query('COMMIT');
      return mapStudent(student);
    }

    const conflictResult =
      await client.query(
        `
          SELECT
            existing_student.id
          FROM school_students
            existing_student
          WHERE
            existing_student.school_id =
              $1
            AND
            existing_student.member_id =
              $2
            AND
            existing_student.id <> $3
            AND
            existing_student.deleted_at
              IS NULL
          LIMIT 1
          FOR UPDATE
        `,
        [
          schoolId,
          targetMemberId,
          studentId,
        ]
      );

    if (conflictResult.rows?.length) {
      throw serviceError(
        'This school member is already linked to another active student record',
        'SCHOOL_STUDENT_MEMBER_ALREADY_USED',
        409
      );
    }

    const updatedResult =
      await client.query(
        `
          UPDATE school_students
          SET
            member_id = $3,
            member_linked_at = NOW(),
            member_linked_by_member_id =
              $4,
            updated_at = NOW()
          WHERE id = $1
            AND school_id = $2
            AND deleted_at IS NULL
          RETURNING
            id,
            school_id,
            member_id,
            admission_number,
            first_name,
            middle_name,
            last_name,
            status,
            member_linked_at,
            member_linked_by_member_id
        `,
        [
          studentId,
          schoolId,
          targetMemberId,
          actorMemberId,
        ]
      );

    const updated =
      updatedResult.rows?.[0];

    if (!updated) {
      throw serviceError(
        'Student identity link could not be saved',
        'SCHOOL_STUDENT_LINK_FAILED',
        409
      );
    }

    await client.query('COMMIT');

    return mapStudent(updated);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original error.
    }

    throw error;
  } finally {
    if (
      releaseClient &&
      typeof client.release === 'function'
    ) {
      client.release();
    }
  }
}

module.exports = {
  LINK_MANAGER_ROLES,
  linkStudentMember,
};
