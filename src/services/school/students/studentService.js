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

function normalizeGender(value) {
  const gender = clean(value);
  if (!gender) return null;

  const normalized = gender.toLowerCase();
  if (!['male', 'female', 'other'].includes(normalized)) {
    const err = new Error('Gender must be male, female, or other');
    err.statusCode = 400;
    throw err;
  }

  return normalized;
}

function normalizeStatus(value) {
  const status = clean(value) || 'active';
  const normalized = status.toLowerCase();

  if (!['active', 'suspended', 'graduated', 'transferred', 'archived'].includes(normalized)) {
    const err = new Error('Invalid student status');
    err.statusCode = 400;
    throw err;
  }

  return normalized;
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

async function createStudent(schoolId, payload = {}) {
  const pool = getPool();

  const firstName = requireText(payload.firstName, 'First name');
  const lastName = requireText(payload.lastName, 'Last name');

  const result = await pool.query(
    `
    INSERT INTO school_students (
      school_id,
      admission_number,
      first_name,
      middle_name,
      last_name,
      gender,
      date_of_birth,
      class_name,
      department,
      guardian_name,
      guardian_phone,
      guardian_email,
      photo_url,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *
    `,
    [
      schoolId,
      clean(payload.admissionNumber),
      firstName,
      clean(payload.middleName),
      lastName,
      normalizeGender(payload.gender),
      clean(payload.dateOfBirth),
      clean(payload.className),
      clean(payload.department),
      clean(payload.guardianName),
      clean(payload.guardianPhone),
      clean(payload.guardianEmail),
      clean(payload.photoUrl),
      normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function listStudents(schoolId, query = {}) {
  const pool = getPool();

  const search = clean(query.search);
  const status = clean(query.status);
  const className = clean(query.className);
  const limit = Math.min(Number(query.limit) || 50, 100);
  const offset = Number(query.offset) || 0;

  const params = [schoolId];
  let where = `
    school_id = $1
    AND deleted_at IS NULL
  `;

  if (search) {
    params.push(`%${search}%`);
    where += `
      AND (
        first_name ILIKE $${params.length}
        OR last_name ILIKE $${params.length}
        OR admission_number ILIKE $${params.length}
        OR guardian_phone ILIKE $${params.length}
      )
    `;
  }

  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }

if (className) {
  params.push(className);
  where += ` AND class_name = $${params.length}`;
}

  params.push(limit);
  const limitParam = params.length;

  params.push(offset);
  const offsetParam = params.length;

  const result = await pool.query(
    `
    SELECT *
    FROM school_students
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT $${limitParam}
    OFFSET $${offsetParam}
    `,
    params
  );

  return result.rows;
}

async function getStudentById(schoolId, studentId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT *
    FROM school_students
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [studentId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Student not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function updateStudent(schoolId, studentId, payload = {}) {
  await getStudentById(schoolId, studentId);

  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_students
    SET
      admission_number = COALESCE($3, admission_number),
      first_name = COALESCE($4, first_name),
      middle_name = COALESCE($5, middle_name),
      last_name = COALESCE($6, last_name),
      gender = COALESCE($7, gender),
      date_of_birth = COALESCE($8, date_of_birth),
      class_name = COALESCE($9, class_name),
      department = COALESCE($10, department),
      guardian_name = COALESCE($11, guardian_name),
      guardian_phone = COALESCE($12, guardian_phone),
      guardian_email = COALESCE($13, guardian_email),
      photo_url = COALESCE($14, photo_url),
      status = COALESCE($15, status),
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
    RETURNING *
    `,
    [
      studentId,
      schoolId,
      clean(payload.admissionNumber),
      clean(payload.firstName),
      clean(payload.middleName),
      clean(payload.lastName),
      payload.gender === undefined ? null : normalizeGender(payload.gender),
      clean(payload.dateOfBirth),
      clean(payload.className),
      clean(payload.department),
      clean(payload.guardianName),
      clean(payload.guardianPhone),
      clean(payload.guardianEmail),
      clean(payload.photoUrl),
      payload.status === undefined ? null : normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function archiveStudent(schoolId, studentId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_students
    SET status = 'archived',
        deleted_at = now(),
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [studentId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Student not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  createStudent,
  listStudents,
  getStudentById,
  updateStudent,
  archiveStudent,
};
