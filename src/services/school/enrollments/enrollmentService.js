'use strict';

const db = require('../../../db');

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') return db.pool;
  if (typeof db.query === 'function') return db;
  throw new Error('Database pool is not available');
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function requireText(value, label) {
  const text = clean(value);
  if (!text) {
    const err = new Error(`${label} is required`);
    err.statusCode = 400;
    throw err;
  }
  return text;
}

function normalizeStatus(value) {
  const status = clean(value) || 'active';
  const allowed = ['active', 'transferred', 'promoted', 'graduated', 'archived'];

  if (!allowed.includes(status)) {
    const err = new Error('Invalid enrollment status');
    err.statusCode = 400;
    throw err;
  }

  return status;
}

async function assertStudentBelongsToSchool(pool, schoolId, studentId) {
  const result = await pool.query(
    `
    SELECT id
    FROM school_students
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [studentId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Student not found in this school');
    err.statusCode = 404;
    throw err;
  }
}

async function assertClassBelongsToSchool(pool, schoolId, classId) {
  const result = await pool.query(
    `
    SELECT id
    FROM school_classes
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [classId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Class not found in this school');
    err.statusCode = 404;
    throw err;
  }
}

async function createEnrollment(schoolId, payload = {}) {
  const pool = getPool();

  const studentId = requireText(payload.studentId, 'Student ID');
  const classId = requireText(payload.classId, 'Class ID');
  const academicSession = requireText(payload.academicSession, 'Academic session');

  await assertStudentBelongsToSchool(pool, schoolId, studentId);
  await assertClassBelongsToSchool(pool, schoolId, classId);

  const result = await pool.query(
    `
    INSERT INTO student_class_enrollments (
      school_id,
      student_id,
      class_id,
      academic_session,
      term,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
    `,
    [
      schoolId,
      studentId,
      classId,
      academicSession,
      clean(payload.term),
      normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function listEnrollments(schoolId, query = {}) {
  const pool = getPool();

  const params = [schoolId];
  let where = `
    e.school_id = $1
    AND e.deleted_at IS NULL
  `;

  if (clean(query.classId)) {
    params.push(clean(query.classId));
    where += ` AND e.class_id = $${params.length}`;
  }

  if (clean(query.studentId)) {
    params.push(clean(query.studentId));
    where += ` AND e.student_id = $${params.length}`;
  }

  if (clean(query.academicSession)) {
    params.push(clean(query.academicSession));
    where += ` AND e.academic_session = $${params.length}`;
  }

  if (clean(query.status)) {
    params.push(clean(query.status));
    where += ` AND e.status = $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT
      e.*,
      s.first_name,
      s.middle_name,
      s.last_name,
      s.admission_number,
      c.name AS class_name,
      c.arm AS class_arm,
      c.level AS class_level
    FROM student_class_enrollments e
    JOIN school_students s ON s.id = e.student_id
    JOIN school_classes c ON c.id = e.class_id
    WHERE ${where}
    ORDER BY e.created_at DESC
    `,
    params
  );

  return result.rows;
}

async function getEnrollmentById(schoolId, enrollmentId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      e.*,
      s.first_name,
      s.middle_name,
      s.last_name,
      s.admission_number,
      c.name AS class_name,
      c.arm AS class_arm,
      c.level AS class_level
    FROM student_class_enrollments e
    JOIN school_students s ON s.id = e.student_id
    JOIN school_classes c ON c.id = e.class_id
    WHERE e.id = $1
      AND e.school_id = $2
      AND e.deleted_at IS NULL
    LIMIT 1
    `,
    [enrollmentId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Enrollment not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function updateEnrollment(schoolId, enrollmentId, payload = {}) {
  await getEnrollmentById(schoolId, enrollmentId);

  const pool = getPool();

  if (payload.studentId) {
    await assertStudentBelongsToSchool(pool, schoolId, payload.studentId);
  }

  if (payload.classId) {
    await assertClassBelongsToSchool(pool, schoolId, payload.classId);
  }

  const result = await pool.query(
    `
    UPDATE student_class_enrollments
    SET
      student_id = COALESCE($3, student_id),
      class_id = COALESCE($4, class_id),
      academic_session = COALESCE($5, academic_session),
      term = COALESCE($6, term),
      status = COALESCE($7, status),
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
    RETURNING *
    `,
    [
      enrollmentId,
      schoolId,
      clean(payload.studentId),
      clean(payload.classId),
      clean(payload.academicSession),
      clean(payload.term),
      payload.status === undefined ? null : normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function archiveEnrollment(schoolId, enrollmentId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE student_class_enrollments
    SET status = 'archived',
        deleted_at = now(),
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [enrollmentId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Enrollment not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  createEnrollment,
  listEnrollments,
  getEnrollmentById,
  updateEnrollment,
  archiveEnrollment,
};
