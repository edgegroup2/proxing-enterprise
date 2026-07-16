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

function fail(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function requireText(value, label) {
  const text = clean(value);
  if (!text) throw fail(`${label} is required`);
  return text;
}

async function createReportCard(schoolId, payload = {}) {
  const pool = getPool();

  const result = await pool.query(
    `
    INSERT INTO school_report_cards (
      school_id,
      student_id,
      class_id,
      academic_session,
      term,
      total_score,
      average_score,
      subject_count,
      grade,
      position,
      promotion_status,
      teacher_comment,
      principal_comment,
      published
    )
    VALUES (
      $1,$2,$3,$4,$5,
      $6,$7,$8,$9,$10,
      $11,$12,$13,$14
    )
    RETURNING *
    `,
    [
      schoolId,
      requireText(payload.studentId, 'Student'),
      clean(payload.classId),
      requireText(payload.academicSession, 'Academic Session'),
      requireText(payload.term, 'Term'),
      Number(payload.totalScore || 0),
      Number(payload.averageScore || 0),
      Number(payload.subjectCount || 0),
      clean(payload.grade),
      payload.position ? Number(payload.position) : null,
      clean(payload.promotionStatus) || 'pending',
      clean(payload.teacherComment),
      clean(payload.principalComment),
      !!payload.published
    ]
  );

  return result.rows[0];
}

async function listReportCards(schoolId, query = {}) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT *
    FROM school_report_cards
    WHERE school_id = $1
      AND deleted_at IS NULL
    ORDER BY generated_at DESC
    `,
    [schoolId]
  );

  return result.rows;
}

module.exports = {
  createReportCard,
  listReportCards,
};
