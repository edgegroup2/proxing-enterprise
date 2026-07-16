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
  const status = clean(value) || 'present';
  const allowed = ['present', 'absent', 'late', 'excused'];

  if (!allowed.includes(status)) {
    const err = new Error('Status must be present, absent, late, or excused');
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

async function markAttendance(schoolId, payload = {}) {
  const pool = getPool();

  const classId = requireText(payload.classId, 'Class ID');
  const studentId = requireText(payload.studentId, 'Student ID');
  const teacherMemberId = clean(payload.teacherMemberId);
  const attendanceDate = requireText(payload.attendanceDate, 'Attendance date');

  await assertRecord(pool, 'school_classes', classId, schoolId, 'Class');
  await assertRecord(pool, 'school_students', studentId, schoolId, 'Student');

  const result = await pool.query(
    `
    INSERT INTO school_attendance (
      school_id,
      class_id,
      student_id,
      teacher_member_id,
      attendance_date,
      status,
      remark
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (school_id, class_id, student_id, attendance_date)
    DO UPDATE SET
      teacher_member_id = EXCLUDED.teacher_member_id,
      status = EXCLUDED.status,
      remark = EXCLUDED.remark,
      updated_at = now(),
      deleted_at = NULL
    RETURNING *
    `,
    [
      schoolId,
      classId,
      studentId,
      teacherMemberId,
      attendanceDate,
      normalizeStatus(payload.status),
      clean(payload.remark),
    ]
  );

  return result.rows[0];
}

async function listAttendance(schoolId, query = {}) {
  const pool = getPool();

  const params = [schoolId];
  let where = `
    a.school_id = $1
    AND a.deleted_at IS NULL
  `;

  if (clean(query.classId)) {
    params.push(clean(query.classId));
    where += ` AND a.class_id = $${params.length}`;
  }

  if (clean(query.studentId)) {
    params.push(clean(query.studentId));
    where += ` AND a.student_id = $${params.length}`;
  }

  if (clean(query.date)) {
    params.push(clean(query.date));
    where += ` AND a.attendance_date = $${params.length}`;
  }

  if (clean(query.status)) {
    params.push(clean(query.status));
    where += ` AND a.status = $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT
      a.*,
      s.first_name,
      s.middle_name,
      s.last_name,
      s.admission_number,
      c.name AS class_name,
      c.arm AS class_arm,
      sm.full_name AS teacher_name
    FROM school_attendance a
    JOIN school_students s ON s.id = a.student_id
    JOIN school_classes c ON c.id = a.class_id
    LEFT JOIN school_members sm ON sm.id = a.teacher_member_id
    WHERE ${where}
    ORDER BY a.attendance_date DESC, s.last_name ASC, s.first_name ASC
    `,
    params
  );

  return result.rows;
}

async function getAttendanceById(schoolId, attendanceId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT *
    FROM school_attendance
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [attendanceId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Attendance record not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function updateAttendance(schoolId, attendanceId, payload = {}) {
  await getAttendanceById(schoolId, attendanceId);

  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_attendance
    SET
      status = COALESCE($3, status),
      remark = COALESCE($4, remark),
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
    RETURNING *
    `,
    [
      attendanceId,
      schoolId,
      payload.status === undefined ? null : normalizeStatus(payload.status),
      clean(payload.remark),
    ]
  );

  return result.rows[0];
}

async function deleteAttendance(schoolId, attendanceId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_attendance
    SET deleted_at = now(),
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [attendanceId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Attendance record not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  markAttendance,
  listAttendance,
  getAttendanceById,
  updateAttendance,
  deleteAttendance,
};
