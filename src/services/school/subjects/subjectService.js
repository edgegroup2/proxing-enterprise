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

async function createSubject(schoolId, payload = {}) {
  const pool = getPool();

  const result = await pool.query(
    `
    INSERT INTO school_subjects (
      school_id,
      name,
      code,
      category,
      description,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
    `,
    [
      schoolId,
      requireText(payload.name, 'Subject name'),
      clean(payload.code),
      clean(payload.category),
      clean(payload.description),
      normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function listSubjects(schoolId, query = {}) {
  const pool = getPool();

  const search = clean(query.search);
  const status = clean(query.status);
  const category = clean(query.category);

  const params = [schoolId];
  let where = `
    school_id = $1
    AND deleted_at IS NULL
  `;

  if (search) {
    params.push(`%${search}%`);
    where += `
      AND (
        name ILIKE $${params.length}
        OR code ILIKE $${params.length}
        OR category ILIKE $${params.length}
      )
    `;
  }

  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }

  if (category) {
    params.push(category);
    where += ` AND category = $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT *
    FROM school_subjects
    WHERE ${where}
    ORDER BY name ASC
    `,
    params
  );

  return result.rows;
}

async function getSubjectById(schoolId, subjectId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT *
    FROM school_subjects
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [subjectId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Subject not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function updateSubject(schoolId, subjectId, payload = {}) {
  await getSubjectById(schoolId, subjectId);

  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_subjects
    SET
      name = COALESCE($3, name),
      code = COALESCE($4, code),
      category = COALESCE($5, category),
      description = COALESCE($6, description),
      status = COALESCE($7, status),
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
    RETURNING *
    `,
    [
      subjectId,
      schoolId,
      clean(payload.name),
      clean(payload.code),
      clean(payload.category),
      clean(payload.description),
      payload.status === undefined ? null : normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function archiveSubject(schoolId, subjectId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_subjects
    SET status = 'archived',
        deleted_at = now(),
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [subjectId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Subject not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  createSubject,
  listSubjects,
  getSubjectById,
  updateSubject,
  archiveSubject,
};
