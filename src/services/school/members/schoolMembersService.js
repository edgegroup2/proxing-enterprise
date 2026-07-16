'use strict';

const db = require('../../../db');

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') return db.pool;
  if (typeof db.query === 'function') return db;
  throw new Error('Database pool is not available');
}

const ROLE_MAP = {
  principal: 'principal',
  admin: 'admin',
  teacher: 'teacher',
  student: 'student',
  guardian: 'guardian',
};

function normalizeRole(role) {
  const key = String(role || '').trim().toLowerCase();
  return ROLE_MAP[key] || null;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function listSchoolMembers(schoolId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      id,
      school_id,
      full_name,
      role,
      email,
      phone,
      status,
      created_at,
      updated_at
    FROM school_members
    WHERE school_id = $1
    ORDER BY created_at DESC
    `,
    [schoolId]
  );

  return result.rows;
}

async function inviteSchoolMember(schoolId, payload = {}) {
  const pool = getPool();

  const fullName = String(payload.fullName || '').trim();
  const email = normalizeEmail(payload.email);
  const phone = String(payload.phone || '').trim() || null;
  const role = normalizeRole(payload.role);

  if (!fullName) {
    const err = new Error('Full name is required');
    err.statusCode = 400;
    throw err;
  }

  if (!email) {
    const err = new Error('Email is required');
    err.statusCode = 400;
    throw err;
  }

  if (!role) {
    const err = new Error('Role must be one of principal, admin, teacher, student, guardian');
    err.statusCode = 400;
    throw err;
  }

  const existing = await pool.query(
    `
    SELECT id, status
    FROM school_members
    WHERE school_id = $1
      AND LOWER(email) = LOWER($2)
    LIMIT 1
    `,
    [schoolId, email]
  );

  if (existing.rows.length) {
    const err = new Error('This email is already a member of this school');
    err.statusCode = 409;
    throw err;
  }

  const result = await pool.query(
    `
    INSERT INTO school_members (
      school_id,
      full_name,
      role,
      email,
      phone,
      status
    )
    VALUES ($1, $2, $3, $4, $5, 'invited')
    RETURNING
      id,
      school_id,
      full_name,
      role,
      email,
      phone,
      status,
      created_at,
      updated_at
    `,
    [schoolId, fullName, role, email, phone]
  );

  return result.rows[0];
}

async function updateSchoolMemberStatus(schoolId, memberId, status) {
  const pool = getPool();

  const allowed = ['invited', 'active', 'suspended', 'removed'];
  const nextStatus = String(status || '').trim().toLowerCase();

  if (!allowed.includes(nextStatus)) {
    const err = new Error('Invalid member status');
    err.statusCode = 400;
    throw err;
  }

  const result = await pool.query(
    `
    UPDATE school_members
    SET status = $3,
        updated_at = now()
    WHERE school_id = $1
      AND id = $2
    RETURNING
      id,
      school_id,
      full_name,
      role,
      email,
      phone,
      status,
      created_at,
      updated_at
    `,
    [schoolId, memberId, nextStatus]
  );

  if (!result.rows.length) {
    const err = new Error('School member not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  listSchoolMembers,
  inviteSchoolMember,
  updateSchoolMemberStatus,
};
