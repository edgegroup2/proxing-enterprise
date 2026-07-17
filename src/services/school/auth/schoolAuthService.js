'use strict';

const jwt = require('jsonwebtoken');
const db = require('../../../db');

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') return db.pool;
  if (typeof db.query === 'function') return db;
  throw new Error('Database pool is not available');
}

function signSchoolToken(payload) {
  const secret =
    typeof process.env.JWT_SECRET === 'string'
      ? process.env.JWT_SECRET.trim()
      : '';

  if (!secret) {
    const err = new Error('JWT_SECRET is not configured');
    err.statusCode = 500;
    err.code = 'SCHOOL_JWT_SECRET_MISSING';
    throw err;
  }

  return jwt.sign(
    {
      scope: 'school',
      schoolId: payload.schoolId,
      schoolName: payload.schoolName,
      memberId: payload.memberId,
      email: payload.email,
      role: payload.role,
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
}

async function loginSchool(payload = {}) {
  const email = String(payload.email || '').trim().toLowerCase();

  if (!email) {
    const err = new Error('Email is required');
    err.statusCode = 400;
    throw err;
  }

  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      sm.id AS member_id,
      sm.school_id,
      sm.full_name,
      sm.role,
      sm.email,
      sm.phone,
      sm.status AS member_status,
      s.name AS school_name,
      s.verification_status
    FROM school_members sm
    JOIN schools s ON s.id = sm.school_id
    WHERE LOWER(sm.email) = LOWER($1)
      AND s.deleted_at IS NULL
    ORDER BY sm.created_at DESC
    LIMIT 1
    `,
    [email]
  );

  if (!result.rows.length) {
    const err = new Error('No school account found for this email');
    err.statusCode = 404;
    throw err;
  }

  const row = result.rows[0];

  if (row.verification_status !== 'verified') {
    const err = new Error('School account is not verified yet');
    err.statusCode = 403;
    err.code = 'SCHOOL_NOT_VERIFIED';
    throw err;
  }

  if (!['invited', 'active'].includes(row.member_status)) {
    const err = new Error('School member account is not active');
    err.statusCode = 403;
    err.code = 'MEMBER_NOT_ACTIVE';
    throw err;
  }

  const token = signSchoolToken({
    schoolId: row.school_id,
    schoolName: row.school_name,
    memberId: row.member_id,
    email: row.email,
    role: row.role,
  });

  return {
    token,
    school: {
      id: row.school_id,
      name: row.school_name,
      verificationStatus: row.verification_status,
    },
    member: {
      id: row.member_id,
      fullName: row.full_name,
      role: row.role,
      email: row.email,
      phone: row.phone,
      status: row.member_status,
    },
  };
}

async function getSchoolProfile(auth = {}) {
  if (!auth.schoolId) {
    const err = new Error('School authentication is required');
    err.statusCode = 401;
    throw err;
  }

  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      s.id,
      s.name,
      s.school_type,
      s.state,
      s.lga,
      s.city,
      s.address,
      s.official_phone,
      s.official_email,
      s.verification_status,
      s.verified_at,
      s.created_at
    FROM schools s
    WHERE s.id = $1
      AND s.deleted_at IS NULL
    LIMIT 1
    `,
    [auth.schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('School not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  loginSchool,
  getSchoolProfile,
};
