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
    const err = new Error('Status must be active, inactive or archived');
    err.statusCode = 400;
    throw err;
  }

  return status;
}

async function assertRecord(pool, table, id, schoolId, label) {
  const result = await pool.query(
    `
    SELECT id
    FROM ${table}
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [id, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error(`${label} not found`);
    err.statusCode = 404;
    throw err;
  }
}

async function createFeeStructure(schoolId, payload = {}) {
  const pool = getPool();

  const classId = clean(payload.classId);
  const categoryId = requireText(payload.categoryId, 'Fee category ID');

  await assertRecord(pool, 'school_fee_categories', categoryId, schoolId, 'Fee category');

  if (classId) {
    await assertRecord(pool, 'school_classes', classId, schoolId, 'Class');
  }

  const result = await pool.query(
    `
    INSERT INTO school_fee_structures (
      school_id,
      class_id,
      category_id,
      academic_session,
      term,
      amount,
      is_mandatory,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *
    `,
    [
      schoolId,
      classId,
      categoryId,
      requireText(payload.academicSession, 'Academic session'),
      requireText(payload.term, 'Term'),
      Number(payload.amount || 0),
      payload.isMandatory !== false,
      normalizeStatus(payload.status)
    ]
  );

  return result.rows[0];
}

async function listFeeStructures(schoolId, query = {}) {
  const pool = getPool();
  const params = [schoolId];

  let where = `
    fs.school_id = $1
    AND fs.deleted_at IS NULL
  `;

  if (clean(query.classId)) {
    params.push(clean(query.classId));
    where += ` AND fs.class_id = $${params.length}`;
  }

  if (clean(query.academicSession)) {
    params.push(clean(query.academicSession));
    where += ` AND fs.academic_session = $${params.length}`;
  }

  if (clean(query.term)) {
    params.push(clean(query.term));
    where += ` AND fs.term = $${params.length}`;
  }

  if (clean(query.status)) {
    params.push(normalizeStatus(query.status));
    where += ` AND fs.status = $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT
      fs.*,
      c.name AS class_name,
      c.arm AS class_arm,
      fc.name AS category_name,
      fc.code AS category_code
    FROM school_fee_structures fs
    LEFT JOIN school_classes c ON c.id = fs.class_id
    JOIN school_fee_categories fc ON fc.id = fs.category_id
    WHERE ${where}
    ORDER BY fs.academic_session DESC, fs.term ASC, c.name ASC, fc.name ASC
    `,
    params
  );

  return result.rows;
}

async function updateFeeStructure(schoolId, structureId, payload = {}) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_fee_structures
    SET
      amount = COALESCE($3, amount),
      is_mandatory = COALESCE($4, is_mandatory),
      status = COALESCE($5, status),
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [
      structureId,
      schoolId,
      payload.amount === undefined ? null : Number(payload.amount),
      payload.isMandatory === undefined ? null : !!payload.isMandatory,
      payload.status === undefined ? null : normalizeStatus(payload.status),
    ]
  );

  if (!result.rows.length) {
    const err = new Error('Fee structure not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function deleteFeeStructure(schoolId, structureId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_fee_structures
    SET deleted_at = now(),
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [structureId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Fee structure not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  createFeeStructure,
  listFeeStructures,
  updateFeeStructure,
  deleteFeeStructure,
};
