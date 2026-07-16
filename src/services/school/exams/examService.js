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
  const status = clean(value) || 'draft';
  const allowed = ['draft', 'published', 'closed', 'archived'];
  if (!allowed.includes(status)) {
    const err = new Error('Invalid exam status');
    err.statusCode = 400;
    throw err;
  }
  return status;
}

function normalizeExamType(value) {
  const type = clean(value) || 'test';
  const allowed = ['test', 'quiz', 'assignment', 'midterm', 'exam', 'mock', 'entrance', 'other'];
  if (!allowed.includes(type)) {
    const err = new Error('Invalid exam type');
    err.statusCode = 400;
    throw err;
  }
  return type;
}

async function assertSubject(pool, schoolId, subjectId) {
  const result = await pool.query(
    `
    SELECT id
    FROM school_subjects
    WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
    LIMIT 1
    `,
    [subjectId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Subject not found in this school');
    err.statusCode = 404;
    throw err;
  }
}

async function assertClass(pool, schoolId, classId) {
  const result = await pool.query(
    `
    SELECT id
    FROM school_classes
    WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
    LIMIT 1
    `,
    [classId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Class not found in this school');
    err.statusCode = 404;
    throw err;
  }
}

async function createExam(schoolId, memberId, payload = {}) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const subjectId = requireText(payload.subjectId, 'Subject ID');
    await assertSubject(client, schoolId, subjectId);

    const examResult = await client.query(
      `
      INSERT INTO school_exams (
        school_id,
        subject_id,
        created_by_member_id,
        title,
        exam_type,
        academic_session,
        term,
        duration_minutes,
        total_marks,
        instructions,
        start_at,
        end_at,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
      `,
      [
        schoolId,
        subjectId,
        clean(memberId),
        requireText(payload.title, 'Exam title'),
        normalizeExamType(payload.examType),
        requireText(payload.academicSession, 'Academic session'),
        clean(payload.term),
        Number(payload.durationMinutes || 60),
        Number(payload.totalMarks || 100),
        clean(payload.instructions),
        clean(payload.startAt),
        clean(payload.endAt),
        normalizeStatus(payload.status),
      ]
    );

    const exam = examResult.rows[0];
    const classIds = Array.isArray(payload.classIds) ? payload.classIds : [];

    for (const classId of classIds) {
      await assertClass(client, schoolId, classId);

      await client.query(
        `
        INSERT INTO school_exam_classes (school_id, exam_id, class_id)
        VALUES ($1,$2,$3)
        ON CONFLICT (exam_id, class_id) DO NOTHING
        `,
        [schoolId, exam.id, classId]
      );
    }

    await client.query('COMMIT');

    return getExamById(schoolId, exam.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listExams(schoolId, query = {}) {
  const pool = getPool();

  const params = [schoolId];
  let where = `
    e.school_id = $1
    AND e.deleted_at IS NULL
  `;

  if (clean(query.status)) {
    params.push(clean(query.status));
    where += ` AND e.status = $${params.length}`;
  }

  if (clean(query.subjectId)) {
    params.push(clean(query.subjectId));
    where += ` AND e.subject_id = $${params.length}`;
  }

  if (clean(query.academicSession)) {
    params.push(clean(query.academicSession));
    where += ` AND e.academic_session = $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT
      e.*,
      s.name AS subject_name,
      s.code AS subject_code,
      COALESCE(
        json_agg(
          json_build_object(
            'id', c.id,
            'name', c.name,
            'arm', c.arm,
            'level', c.level
          )
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'
      ) AS classes
    FROM school_exams e
    JOIN school_subjects s ON s.id = e.subject_id
    LEFT JOIN school_exam_classes ec ON ec.exam_id = e.id
    LEFT JOIN school_classes c ON c.id = ec.class_id
    WHERE ${where}
    GROUP BY e.id, s.name, s.code
    ORDER BY e.created_at DESC
    `,
    params
  );

  return result.rows;
}

async function getExamById(schoolId, examId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      e.*,
      s.name AS subject_name,
      s.code AS subject_code,
      COALESCE(
        json_agg(
          json_build_object(
            'id', c.id,
            'name', c.name,
            'arm', c.arm,
            'level', c.level
          )
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'
      ) AS classes
    FROM school_exams e
    JOIN school_subjects s ON s.id = e.subject_id
    LEFT JOIN school_exam_classes ec ON ec.exam_id = e.id
    LEFT JOIN school_classes c ON c.id = ec.class_id
    WHERE e.id = $1
      AND e.school_id = $2
      AND e.deleted_at IS NULL
    GROUP BY e.id, s.name, s.code
    LIMIT 1
    `,
    [examId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Exam not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function updateExam(schoolId, examId, payload = {}) {
  await getExamById(schoolId, examId);

  const pool = getPool();

  if (payload.subjectId) {
    await assertSubject(pool, schoolId, payload.subjectId);
  }

  const result = await pool.query(
    `
    UPDATE school_exams
    SET
      subject_id = COALESCE($3, subject_id),
      title = COALESCE($4, title),
      exam_type = COALESCE($5, exam_type),
      academic_session = COALESCE($6, academic_session),
      term = COALESCE($7, term),
      duration_minutes = COALESCE($8, duration_minutes),
      total_marks = COALESCE($9, total_marks),
      instructions = COALESCE($10, instructions),
      start_at = COALESCE($11, start_at),
      end_at = COALESCE($12, end_at),
      status = COALESCE($13, status),
      updated_at = now()
    WHERE id = $1 AND school_id = $2
    RETURNING *
    `,
    [
      examId,
      schoolId,
      clean(payload.subjectId),
      clean(payload.title),
      payload.examType === undefined ? null : normalizeExamType(payload.examType),
      clean(payload.academicSession),
      clean(payload.term),
      payload.durationMinutes === undefined ? null : Number(payload.durationMinutes),
      payload.totalMarks === undefined ? null : Number(payload.totalMarks),
      clean(payload.instructions),
      clean(payload.startAt),
      clean(payload.endAt),
      payload.status === undefined ? null : normalizeStatus(payload.status),
    ]
  );

  return result.rows[0];
}

async function archiveExam(schoolId, examId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_exams
    SET status = 'archived',
        deleted_at = now(),
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [examId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Exam not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function addExamQuestion(schoolId, examId, payload = {}) {
  await getExamById(schoolId, examId);

  const pool = getPool();

  const questionId = requireText(payload.questionId, 'Question ID');
  const position = Number(payload.position || 1);
  const marks = Number(payload.marks || 1);
  const negativeMarks = Number(payload.negativeMarks || 0);
  const isRequired = payload.isRequired === undefined ? true : Boolean(payload.isRequired);

  const result = await pool.query(
    `
    INSERT INTO school_exam_questions (
      school_id,
      exam_id,
      question_id,
      position,
      marks,
      negative_marks,
      is_required
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (exam_id, question_id)
    DO UPDATE SET
      position = EXCLUDED.position,
      marks = EXCLUDED.marks,
      negative_marks = EXCLUDED.negative_marks,
      is_required = EXCLUDED.is_required,
      updated_at = now()
    RETURNING *
    `,
    [schoolId, examId, questionId, position, marks, negativeMarks, isRequired]
  );

  return result.rows[0];
}

async function listExamQuestions(schoolId, examId) {
  await getExamById(schoolId, examId);

  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      eq.*,
      qb.question_text,
      qb.options,
      qb.answer_key,
      qb.explanation,
      qb.topic,
      qb.difficulty
    FROM school_exam_questions eq
    JOIN school_question_bank qb ON qb.id = eq.question_id
    WHERE eq.school_id = $1
      AND eq.exam_id = $2
    ORDER BY eq.position ASC, eq.created_at ASC
    `,
    [schoolId, examId]
  );

  return result.rows;
}

async function updateExamQuestion(schoolId, examId, examQuestionId, payload = {}) {
  await getExamById(schoolId, examId);

  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_exam_questions
    SET
      position = COALESCE($4, position),
      marks = COALESCE($5, marks),
      negative_marks = COALESCE($6, negative_marks),
      is_required = COALESCE($7, is_required),
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND exam_id = $3
    RETURNING *
    `,
    [
      examQuestionId,
      schoolId,
      examId,
      payload.position === undefined ? null : Number(payload.position),
      payload.marks === undefined ? null : Number(payload.marks),
      payload.negativeMarks === undefined ? null : Number(payload.negativeMarks),
      payload.isRequired === undefined ? null : Boolean(payload.isRequired),
    ]
  );

  if (!result.rows.length) {
    const err = new Error('Exam question not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function deleteExamQuestion(schoolId, examId, examQuestionId) {
  await getExamById(schoolId, examId);

  const pool = getPool();

  const result = await pool.query(
    `
    DELETE FROM school_exam_questions
    WHERE id = $1
      AND school_id = $2
      AND exam_id = $3
    RETURNING *
    `,
    [examQuestionId, schoolId, examId]
  );

  if (!result.rows.length) {
    const err = new Error('Exam question not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function publishExam(schoolId, examId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_exams
    SET status = 'published',
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [examId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Exam not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function closeExam(schoolId, examId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_exams
    SET status = 'closed',
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [examId, schoolId]
  );

  if (!result.rows.length) {
    const err = new Error('Exam not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  createExam,
  listExams,
  getExamById,
  updateExam,
  archiveExam,
  addExamQuestion,
  listExamQuestions,
  updateExamQuestion,
  deleteExamQuestion,
  publishExam,
  closeExam,
};
