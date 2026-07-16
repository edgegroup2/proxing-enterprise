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
  const allowed = ['active', 'inactive', 'archived'];

  if (!allowed.includes(status)) {
    const err = new Error('Status must be active, inactive, or archived');
    err.statusCode = 400;
    throw err;
  }

  return status;
}

async function createClass(schoolId, payload = {}) {
  const pool = getPool();

  const result = await pool.query(
    `
    INSERT INTO school_classes (
      school_id,
      name,
      level,
      arm,
      class_teacher_member_id,
      capacity,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
    `,
    [
      schoolId,
      requireText(payload.name, 'Class name'),
      clean(payload.level),
      clean(payload.arm),
      clean(payload.classTeacherMemberId),
      payload.capacity === undefined || payload.capacity === null ? null : Number(payload.capacity),
      normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function listClasses(schoolId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      c.*,
      sm.full_name AS class_teacher_name,
      sm.email AS class_teacher_email
    FROM school_classes c
    LEFT JOIN school_members sm
      ON sm.id = c.class_teacher_member_id
    WHERE c.school_id = $1
      AND c.deleted_at IS NULL
    ORDER BY c.name ASC, c.arm ASC
    `,
    [schoolId]
  );

  return result.rows;
}

async function getClassById(schoolId, classId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      c.*,
      sm.full_name AS class_teacher_name,
      sm.email AS class_teacher_email
    FROM school_classes c
    LEFT JOIN school_members sm
      ON sm.id = c.class_teacher_member_id
    WHERE c.id = $1
      AND c.school_id = $2
      AND c.deleted_at IS NULL
    LIMIT 1
    `,
    [classId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Class not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function updateClass(schoolId, classId, payload = {}) {
  await getClassById(schoolId, classId);

  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_classes
    SET
      name = COALESCE($3, name),
      level = COALESCE($4, level),
      arm = COALESCE($5, arm),
      class_teacher_member_id = COALESCE($6, class_teacher_member_id),
      capacity = COALESCE($7, capacity),
      status = COALESCE($8, status),
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
    RETURNING *
    `,
    [
      classId,
      schoolId,
      clean(payload.name),
      clean(payload.level),
      clean(payload.arm),
      clean(payload.classTeacherMemberId),
      payload.capacity === undefined ? null : Number(payload.capacity),
      payload.status === undefined ? null : normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function archiveClass(schoolId, classId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_classes
    SET status = 'archived',
        deleted_at = now(),
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [classId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Class not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  createClass,
  listClasses,
  getClassById,
  updateClass,
  archiveClass,
};
