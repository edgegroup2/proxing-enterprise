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

function normalizeDay(value) {
  const day = requireText(value, 'Day of week').toLowerCase();
  const allowed = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  if (!allowed.includes(day)) {
    const err = new Error('Day must be monday, Tuesday, etc. Use lowercase or normal day names.');
    err.statusCode = 400;
    throw err;
  }

  return day;
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

async function assertSchoolRecord(pool, table, id, schoolId, label) {
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

async function assertTeacher(pool, teacherMemberId, schoolId) {
  if (!teacherMemberId) return;

  const result = await pool.query(
    `
    SELECT id
    FROM school_members
    WHERE id = $1
      AND school_id = $2
      AND role IN ('teacher', 'admin', 'principal')
      AND status IN ('active', 'invited')
    LIMIT 1
    `,
    [teacherMemberId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Teacher/member not found in this school');
    err.statusCode = 404;
    throw err;
  }
}

async function createTimetableEntry(schoolId, payload = {}) {
  const pool = getPool();

  const classId = requireText(payload.classId, 'Class ID');
  const subjectId = requireText(payload.subjectId, 'Subject ID');
  const teacherMemberId = clean(payload.teacherMemberId);

  await assertSchoolRecord(pool, 'school_classes', classId, schoolId, 'Class');
  await assertSchoolRecord(pool, 'school_subjects', subjectId, schoolId, 'Subject');
  await assertTeacher(pool, teacherMemberId, schoolId);

  const result = await pool.query(
    `
    INSERT INTO school_timetables (
      school_id,
      class_id,
      subject_id,
      teacher_member_id,
      day_of_week,
      start_time,
      end_time,
      room,
      note,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
    `,
    [
      schoolId,
      classId,
      subjectId,
      teacherMemberId,
      normalizeDay(payload.dayOfWeek),
      requireText(payload.startTime, 'Start time'),
      requireText(payload.endTime, 'End time'),
      clean(payload.room),
      clean(payload.note),
      normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function listTimetableEntries(schoolId, query = {}) {
  const pool = getPool();

  const params = [schoolId];
  let where = `
    t.school_id = $1
    AND t.deleted_at IS NULL
  `;

  if (clean(query.classId)) {
    params.push(clean(query.classId));
    where += ` AND t.class_id = $${params.length}`;
  }

  if (clean(query.subjectId)) {
    params.push(clean(query.subjectId));
    where += ` AND t.subject_id = $${params.length}`;
  }

  if (clean(query.dayOfWeek)) {
    params.push(clean(query.dayOfWeek).toLowerCase());
    where += ` AND t.day_of_week = $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT
      t.*,
      c.name AS class_name,
      c.arm AS class_arm,
      c.level AS class_level,
      s.name AS subject_name,
      s.code AS subject_code,
      sm.full_name AS teacher_name,
      sm.email AS teacher_email
    FROM school_timetables t
    JOIN school_classes c ON c.id = t.class_id
    JOIN school_subjects s ON s.id = t.subject_id
    LEFT JOIN school_members sm ON sm.id = t.teacher_member_id
    WHERE ${where}
    ORDER BY
      CASE t.day_of_week
        WHEN 'monday' THEN 1
        WHEN 'tuesday' THEN 2
        WHEN 'wednesday' THEN 3
        WHEN 'thursday' THEN 4
        WHEN 'friday' THEN 5
        WHEN 'saturday' THEN 6
        WHEN 'sunday' THEN 7
      END,
      t.start_time ASC
    `,
    params
  );

  return result.rows;
}

async function getTimetableEntryById(schoolId, timetableId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      t.*,
      c.name AS class_name,
      c.arm AS class_arm,
      c.level AS class_level,
      s.name AS subject_name,
      s.code AS subject_code,
      sm.full_name AS teacher_name,
      sm.email AS teacher_email
    FROM school_timetables t
    JOIN school_classes c ON c.id = t.class_id
    JOIN school_subjects s ON s.id = t.subject_id
    LEFT JOIN school_members sm ON sm.id = t.teacher_member_id
    WHERE t.id = $1
      AND t.school_id = $2
      AND t.deleted_at IS NULL
    LIMIT 1
    `,
    [timetableId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Timetable entry not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function updateTimetableEntry(schoolId, timetableId, payload = {}) {
  await getTimetableEntryById(schoolId, timetableId);

  const pool = getPool();

  if (payload.classId) {
    await assertSchoolRecord(pool, 'school_classes', payload.classId, schoolId, 'Class');
  }

  if (payload.subjectId) {
    await assertSchoolRecord(pool, 'school_subjects', payload.subjectId, schoolId, 'Subject');
  }

  if (payload.teacherMemberId) {
    await assertTeacher(pool, payload.teacherMemberId, schoolId);
  }

  const result = await pool.query(
    `
    UPDATE school_timetables
    SET
      class_id = COALESCE($3, class_id),
      subject_id = COALESCE($4, subject_id),
      teacher_member_id = COALESCE($5, teacher_member_id),
      day_of_week = COALESCE($6, day_of_week),
      start_time = COALESCE($7, start_time),
      end_time = COALESCE($8, end_time),
      room = COALESCE($9, room),
      note = COALESCE($10, note),
      status = COALESCE($11, status),
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [
      timetableId,
      schoolId,
      clean(payload.classId),
      clean(payload.subjectId),
      clean(payload.teacherMemberId),
      payload.dayOfWeek === undefined ? null : normalizeDay(payload.dayOfWeek),
      clean(payload.startTime),
      clean(payload.endTime),
      clean(payload.room),
      clean(payload.note),
      payload.status === undefined ? null : normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function archiveTimetableEntry(schoolId, timetableId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_timetables
    SET status = 'archived',
        deleted_at = now(),
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [timetableId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Timetable entry not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  createTimetableEntry,
  listTimetableEntries,
  getTimetableEntryById,
  updateTimetableEntry,
  archiveTimetableEntry,
};
