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

function calculateGrade(score) {
  const n = Number(score);
  if (n >= 80) return 'A';
  if (n >= 70) return 'B';
  if (n >= 60) return 'C';
  if (n >= 50) return 'D';
  if (n >= 40) return 'E';
  return 'F';
}

function defaultRemark(grade) {
  return {
    A: 'Excellent',
    B: 'Very good',
    C: 'Good',
    D: 'Fair',
    E: 'Pass',
    F: 'Needs improvement',
  }[grade] || null;
}

function normalizeStatus(value) {
  const status = clean(value) || 'recorded';
  const allowed = ['recorded', 'approved', 'published', 'archived'];

  if (!allowed.includes(status)) {
    const err = new Error('Invalid result status');
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
    const err = new Error(`${label} not found in this school`);
    err.statusCode = 404;
    throw err;
  }
}

async function createResult(schoolId, memberId, payload = {}) {
  const pool = getPool();

  const examId = requireText(payload.examId, 'Exam ID');
  const studentId = requireText(payload.studentId, 'Student ID');
  const subjectId = requireText(payload.subjectId, 'Subject ID');
  const classId = requireText(payload.classId, 'Class ID');
  const score = Number(payload.score);

  if (Number.isNaN(score) || score < 0) {
    const err = new Error('Score must be a valid number greater than or equal to 0');
    err.statusCode = 400;
    throw err;
  }

  await assertRecord(pool, 'school_exams', examId, schoolId, 'Exam');
  await assertRecord(pool, 'school_students', studentId, schoolId, 'Student');
  await assertRecord(pool, 'school_subjects', subjectId, schoolId, 'Subject');
  await assertRecord(pool, 'school_classes', classId, schoolId, 'Class');

  const grade = clean(payload.grade) || calculateGrade(score);
  const remark = clean(payload.remark) || defaultRemark(grade);

  const result = await pool.query(
    `
    INSERT INTO school_results (
      school_id,
      exam_id,
      student_id,
      subject_id,
      class_id,
      teacher_member_id,
      score,
      grade,
      remark,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (school_id, exam_id, student_id, subject_id)
    DO UPDATE SET
      class_id = EXCLUDED.class_id,
      teacher_member_id = EXCLUDED.teacher_member_id,
      score = EXCLUDED.score,
      grade = EXCLUDED.grade,
      remark = EXCLUDED.remark,
      status = EXCLUDED.status,
      updated_at = now(),
      deleted_at = NULL
    RETURNING *
    `,
    [
      schoolId,
      examId,
      studentId,
      subjectId,
      classId,
      clean(payload.teacherMemberId) || clean(memberId),
      score,
      grade,
      remark,
      normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function listResults(schoolId, query = {}) {
  const pool = getPool();

  const params = [schoolId];
  let where = `r.school_id = $1 AND r.deleted_at IS NULL`;

  if (clean(query.examId)) {
    params.push(clean(query.examId));
    where += ` AND r.exam_id = $${params.length}`;
  }

  if (clean(query.studentId)) {
    params.push(clean(query.studentId));
    where += ` AND r.student_id = $${params.length}`;
  }

  if (clean(query.classId)) {
    params.push(clean(query.classId));
    where += ` AND r.class_id = $${params.length}`;
  }

  if (clean(query.subjectId)) {
    params.push(clean(query.subjectId));
    where += ` AND r.subject_id = $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT
      r.*,
      e.title AS exam_title,
      e.exam_type,
      e.academic_session,
      e.term,
      s.first_name,
      s.middle_name,
      s.last_name,
      s.admission_number,
      sub.name AS subject_name,
      sub.code AS subject_code,
      c.name AS class_name,
      c.arm AS class_arm,
      sm.full_name AS teacher_name
    FROM school_results r
    JOIN school_exams e ON e.id = r.exam_id
    JOIN school_students s ON s.id = r.student_id
    JOIN school_subjects sub ON sub.id = r.subject_id
    JOIN school_classes c ON c.id = r.class_id
    LEFT JOIN school_members sm ON sm.id = r.teacher_member_id
    WHERE ${where}
    ORDER BY r.created_at DESC
    `,
    params
  );

  return result.rows;
}

async function getResultById(schoolId, resultId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT *
    FROM school_results
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [resultId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Result not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function updateResult(schoolId, resultId, payload = {}) {
  await getResultById(schoolId, resultId);

  const pool = getPool();

  let grade = null;
  let remark = clean(payload.remark);

  if (payload.score !== undefined) {
    grade = clean(payload.grade) || calculateGrade(Number(payload.score));
    remark = remark || defaultRemark(grade);
  } else if (payload.grade !== undefined) {
    grade = clean(payload.grade);
  }

  const result = await pool.query(
    `
    UPDATE school_results
    SET
      score = COALESCE($3, score),
      grade = COALESCE($4, grade),
      remark = COALESCE($5, remark),
      status = COALESCE($6, status),
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
    RETURNING *
    `,
    [
      resultId,
      schoolId,
      payload.score === undefined ? null : Number(payload.score),
      grade,
      remark,
      payload.status === undefined ? null : normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function archiveResult(schoolId, resultId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_results
    SET status = 'archived',
        deleted_at = now(),
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [resultId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Result not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  createResult,
  listResults,
  getResultById,
  updateResult,
  archiveResult,
};
