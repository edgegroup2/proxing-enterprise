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

function enumValue(value, fallback, allowed, label) {
  const text = clean(value) || fallback;

  if (!allowed.includes(text)) {
    throw fail(`${label} must be one of: ${allowed.join(', ')}`);
  }

  return text;
}

async function createLessonNote(schoolId, memberId, payload = {}) {
  const pool = getPool();

  const status = enumValue(payload.status, 'draft', ['draft', 'published', 'archived'], 'Status');

  const result = await pool.query(
    `
    INSERT INTO school_lesson_notes (
      school_id, class_id, subject_id, teacher_member_id,
      title, topic, content, material_type,
      file_url, file_meta, visibility, status, published_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
    RETURNING *
    `,
    [
      schoolId,
      clean(payload.classId),
      clean(payload.subjectId),
      clean(payload.teacherMemberId) || clean(memberId),
      requireText(payload.title, 'Title'),
      clean(payload.topic),
      clean(payload.content),
      enumValue(payload.materialType, 'note', ['note','pdf','video','audio','link','slide','document'], 'Material type'),
      clean(payload.fileUrl),
      JSON.stringify(payload.fileMeta || {}),
      enumValue(payload.visibility, 'class', ['class','school','teachers'], 'Visibility'),
      status,
      status === 'published' ? new Date() : null,
    ]
  );

  return result.rows[0];
}

async function listLessonNotes(schoolId, query = {}) {
  const pool = getPool();
  const params = [schoolId];

  let where = `
    ln.school_id = $1
    AND ln.deleted_at IS NULL
  `;

  if (clean(query.classId)) {
    params.push(clean(query.classId));
    where += ` AND ln.class_id = $${params.length}`;
  }

  if (clean(query.subjectId)) {
    params.push(clean(query.subjectId));
    where += ` AND ln.subject_id = $${params.length}`;
  }

  if (clean(query.status)) {
    params.push(enumValue(query.status, 'draft', ['draft','published','archived'], 'Status'));
    where += ` AND ln.status = $${params.length}`;
  }

  if (clean(query.materialType)) {
    params.push(enumValue(query.materialType, 'note', ['note','pdf','video','audio','link','slide','document'], 'Material type'));
    where += ` AND ln.material_type = $${params.length}`;
  }

  if (clean(query.search)) {
    params.push(`%${clean(query.search)}%`);
    where += ` AND (ln.title ILIKE $${params.length} OR ln.topic ILIKE $${params.length} OR ln.content ILIKE $${params.length})`;
  }

  const result = await pool.query(
    `
    SELECT
      ln.*,
      c.name AS class_name,
      c.arm AS class_arm,
      s.name AS subject_name,
      s.code AS subject_code,
      m.full_name AS teacher_name
    FROM school_lesson_notes ln
    LEFT JOIN school_classes c ON c.id = ln.class_id
    LEFT JOIN school_subjects s ON s.id = ln.subject_id
    LEFT JOIN school_members m ON m.id = ln.teacher_member_id
    WHERE ${where}
    ORDER BY ln.created_at DESC
    `,
    params
  );

  return result.rows;
}

async function getLessonNoteById(schoolId, noteId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      ln.*,
      c.name AS class_name,
      c.arm AS class_arm,
      s.name AS subject_name,
      s.code AS subject_code,
      m.full_name AS teacher_name
    FROM school_lesson_notes ln
    LEFT JOIN school_classes c ON c.id = ln.class_id
    LEFT JOIN school_subjects s ON s.id = ln.subject_id
    LEFT JOIN school_members m ON m.id = ln.teacher_member_id
    WHERE ln.id = $1
      AND ln.school_id = $2
      AND ln.deleted_at IS NULL
    LIMIT 1
    `,
    [noteId, schoolId]
  );

  if (!result.rows.length) throw fail('Lesson note not found', 404);
  return result.rows[0];
}

async function updateLessonNote(schoolId, noteId, payload = {}) {
  const existing = await getLessonNoteById(schoolId, noteId);
  const pool = getPool();

  const status = payload.status === undefined
    ? existing.status
    : enumValue(payload.status, existing.status, ['draft','published','archived'], 'Status');

  const result = await pool.query(
    `
    UPDATE school_lesson_notes
    SET
      class_id = $3,
      subject_id = $4,
      teacher_member_id = $5,
      title = $6,
      topic = $7,
      content = $8,
      material_type = $9,
      file_url = $10,
      file_meta = $11::jsonb,
      visibility = $12,
      status = $13,
      published_at = CASE
        WHEN $13 = 'published' AND published_at IS NULL THEN now()
        ELSE published_at
      END,
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [
      noteId,
      schoolId,
      payload.classId === undefined ? existing.class_id : clean(payload.classId),
      payload.subjectId === undefined ? existing.subject_id : clean(payload.subjectId),
      payload.teacherMemberId === undefined ? existing.teacher_member_id : clean(payload.teacherMemberId),
      payload.title === undefined ? existing.title : requireText(payload.title, 'Title'),
      payload.topic === undefined ? existing.topic : clean(payload.topic),
      payload.content === undefined ? existing.content : clean(payload.content),
      payload.materialType === undefined ? existing.material_type : enumValue(payload.materialType, existing.material_type, ['note','pdf','video','audio','link','slide','document'], 'Material type'),
      payload.fileUrl === undefined ? existing.file_url : clean(payload.fileUrl),
      JSON.stringify(payload.fileMeta === undefined ? existing.file_meta || {} : payload.fileMeta || {}),
      payload.visibility === undefined ? existing.visibility : enumValue(payload.visibility, existing.visibility, ['class','school','teachers'], 'Visibility'),
      status,
    ]
  );

  return result.rows[0];
}

async function publishLessonNote(schoolId, noteId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_lesson_notes
    SET status = 'published',
        published_at = COALESCE(published_at, now()),
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [noteId, schoolId]
  );

  if (!result.rows.length) throw fail('Lesson note not found', 404);
  return result.rows[0];
}

async function archiveLessonNote(schoolId, noteId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_lesson_notes
    SET status = 'archived',
        deleted_at = now(),
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [noteId, schoolId]
  );

  if (!result.rows.length) throw fail('Lesson note not found', 404);
  return result.rows[0];
}

module.exports = {
  createLessonNote,
  listLessonNotes,
  getLessonNoteById,
  updateLessonNote,
  publishLessonNote,
  archiveLessonNote,
};
