'use strict';

const db = require('../../../db');

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') {
    return db.pool;
  }

  if (typeof db.query === 'function') {
    return db;
  }

  throw new Error('Database pool is not available');
}

function clean(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function createError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;

  if (code) {
    error.code = code;
  }

  return error;
}

function requireText(value, label) {
  const text = clean(value);

  if (!text) {
    throw createError(`${label} is required`);
  }

  return text;
}

function normalizeEnum(value, fallback, allowed, label) {
  const normalized = clean(value) || fallback;

  if (!allowed.includes(normalized)) {
    throw createError(
      `${label} must be one of: ${allowed.join(', ')}`
    );
  }

  return normalized;
}

function normalizeNumber(value, fallback, label, minimum = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < minimum) {
    throw createError(
      `${label} must be a valid number greater than or equal to ${minimum}`
    );
  }

  return number;
}

function normalizeQuestionType(value) {
  return normalizeEnum(
    value,
    'single_choice',
    [
      'single_choice',
      'multiple_choice',
      'true_false',
      'short_answer',
      'essay',
    ],
    'Question type'
  );
}

function normalizeDifficulty(value) {
  return normalizeEnum(
    value,
    'medium',
    ['easy', 'medium', 'hard', 'advanced'],
    'Difficulty'
  );
}

function normalizeStatus(value) {
  return normalizeEnum(
    value,
    'draft',
    ['draft', 'active', 'archived'],
    'Status'
  );
}

function normalizeOptions(questionType, suppliedOptions) {
  if (questionType === 'true_false') {
    return [
      { id: 'true', text: 'True' },
      { id: 'false', text: 'False' },
    ];
  }

  if (
    questionType === 'short_answer' ||
    questionType === 'essay'
  ) {
    return [];
  }

  if (!Array.isArray(suppliedOptions)) {
    throw createError(
      'Options must be an array for objective questions'
    );
  }

  const normalized = suppliedOptions
    .map((option, index) => {
      if (typeof option === 'string') {
        const text = clean(option);

        return text
          ? {
              id: String.fromCharCode(65 + index),
              text,
            }
          : null;
      }

      if (option && typeof option === 'object') {
        const text = clean(option.text);
        const id = clean(option.id) || String.fromCharCode(65 + index);

        return text ? { id, text } : null;
      }

      return null;
    })
    .filter(Boolean);

  if (normalized.length < 2) {
    throw createError(
      'Objective questions require at least two valid options'
    );
  }

  const uniqueIds = new Set(normalized.map((option) => option.id));

  if (uniqueIds.size !== normalized.length) {
    throw createError('Every option must have a unique ID');
  }

  return normalized;
}

function normalizeAnswerKey(questionType, answerKey, options) {
  if (questionType === 'essay') {
    return answerKey === undefined ? null : answerKey;
  }

  if (answerKey === undefined || answerKey === null || answerKey === '') {
    throw createError(
      'Answer key is required for non-essay questions'
    );
  }

  if (questionType === 'multiple_choice') {
    const values = Array.isArray(answerKey)
      ? answerKey.map((value) => String(value))
      : [String(answerKey)];

    if (!values.length) {
      throw createError(
        'Multiple-choice questions require at least one correct answer'
      );
    }

    const allowedIds = new Set(options.map((option) => option.id));

    for (const value of values) {
      if (!allowedIds.has(value)) {
        throw createError(
          `Answer key "${value}" does not match any option ID`
        );
      }
    }

    return values;
  }

  if (
    questionType === 'single_choice' ||
    questionType === 'true_false'
  ) {
    const value = String(answerKey);
    const allowedIds = new Set(options.map((option) => option.id));

    if (!allowedIds.has(value)) {
      throw createError(
        `Answer key "${value}" does not match any option ID`
      );
    }

    return value;
  }

  return answerKey;
}

async function assertSchoolRecord(
  pool,
  table,
  id,
  schoolId,
  label
) {
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
    throw createError(`${label} not found in this school`, 404);
  }

  return result.rows[0];
}

async function getQuestionById(schoolId, questionId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      q.*,
      s.name AS subject_name,
      s.code AS subject_code,
      c.name AS class_name,
      c.arm AS class_arm,
      c.level AS class_level,
      sm.full_name AS created_by_name
    FROM school_question_bank q
    JOIN school_subjects s
      ON s.id = q.subject_id
    LEFT JOIN school_classes c
      ON c.id = q.class_id
    LEFT JOIN school_members sm
      ON sm.id = q.created_by_member_id
    WHERE q.id = $1
      AND q.school_id = $2
      AND q.deleted_at IS NULL
    LIMIT 1
    `,
    [questionId, schoolId]
  );

  if (!result.rows.length) {
    throw createError('Question not found', 404);
  }

  return result.rows[0];
}

async function createQuestion(
  schoolId,
  memberId,
  payload = {}
) {
  const pool = getPool();

  const subjectId = requireText(
    payload.subjectId,
    'Subject ID'
  );

  const classId = clean(payload.classId);

  await assertSchoolRecord(
    pool,
    'school_subjects',
    subjectId,
    schoolId,
    'Subject'
  );

  if (classId) {
    await assertSchoolRecord(
      pool,
      'school_classes',
      classId,
      schoolId,
      'Class'
    );
  }

  const questionType = normalizeQuestionType(
    payload.questionType
  );

  const options = normalizeOptions(
    questionType,
    payload.options
  );

  const answerKey = normalizeAnswerKey(
    questionType,
    hasOwn(payload, 'answerKey')
      ? payload.answerKey
      : payload.correctAnswer,
    options
  );

  try {
    const result = await pool.query(
      `
      INSERT INTO school_question_bank (
        school_id,
        subject_id,
        class_id,
        created_by_member_id,
        topic,
        subtopic,
        curriculum,
        syllabus_reference,
        question_type,
        question_text,
        options,
        answer_key,
        explanation,
        difficulty,
        default_marks,
        default_negative_marks,
        media,
        source,
        language_code,
        status
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11::jsonb,$12::jsonb,$13,$14,$15,$16,
        $17::jsonb,$18,$19,$20
      )
      RETURNING *
      `,
      [
        schoolId,
        subjectId,
        classId,
        clean(memberId),
        clean(payload.topic),
        clean(payload.subtopic),
        clean(payload.curriculum),
        clean(payload.syllabusReference),
        questionType,
        requireText(payload.questionText, 'Question text'),
        JSON.stringify(options),
        answerKey === null ? null : JSON.stringify(answerKey),
        clean(payload.explanation),
        normalizeDifficulty(payload.difficulty),
        normalizeNumber(
          payload.defaultMarks,
          1,
          'Default marks',
          0.01
        ),
        normalizeNumber(
          payload.defaultNegativeMarks,
          0,
          'Default negative marks',
          0
        ),
        JSON.stringify(
          payload.media && typeof payload.media === 'object'
            ? payload.media
            : {}
        ),
        clean(payload.source),
        clean(payload.languageCode) || 'en',
        normalizeStatus(payload.status),
      ]
    );

    return getQuestionById(schoolId, result.rows[0].id);
  } catch (error) {
    if (error.code === '23505') {
      error.statusCode = 409;
    }

    throw error;
  }
}

async function listQuestions(schoolId, query = {}) {
  const pool = getPool();

  const params = [schoolId];

  let where = `
    q.school_id = $1
    AND q.deleted_at IS NULL
  `;

  if (clean(query.subjectId)) {
    params.push(clean(query.subjectId));
    where += ` AND q.subject_id = $${params.length}`;
  }

  if (clean(query.classId)) {
    params.push(clean(query.classId));
    where += ` AND q.class_id = $${params.length}`;
  }

  if (clean(query.topic)) {
    params.push(clean(query.topic));
    where += ` AND LOWER(q.topic) = LOWER($${params.length})`;
  }

  if (clean(query.questionType)) {
    params.push(normalizeQuestionType(query.questionType));
    where += ` AND q.question_type = $${params.length}`;
  }

  if (clean(query.difficulty)) {
    params.push(normalizeDifficulty(query.difficulty));
    where += ` AND q.difficulty = $${params.length}`;
  }

  if (clean(query.status)) {
    params.push(normalizeStatus(query.status));
    where += ` AND q.status = $${params.length}`;
  }

  if (clean(query.search)) {
    params.push(`%${clean(query.search)}%`);

    where += `
      AND (
        q.question_text ILIKE $${params.length}
        OR q.topic ILIKE $${params.length}
        OR q.subtopic ILIKE $${params.length}
        OR q.source ILIKE $${params.length}
      )
    `;
  }

  const requestedLimit = Number(query.limit || 50);
  const requestedOffset = Number(query.offset || 0);

  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 200)
    : 50;

  const offset = Number.isFinite(requestedOffset)
    ? Math.max(requestedOffset, 0)
    : 0;

  params.push(limit);
  const limitPosition = params.length;

  params.push(offset);
  const offsetPosition = params.length;

  const result = await pool.query(
    `
    SELECT
      q.*,
      s.name AS subject_name,
      s.code AS subject_code,
      c.name AS class_name,
      c.arm AS class_arm,
      c.level AS class_level,
      sm.full_name AS created_by_name
    FROM school_question_bank q
    JOIN school_subjects s
      ON s.id = q.subject_id
    LEFT JOIN school_classes c
      ON c.id = q.class_id
    LEFT JOIN school_members sm
      ON sm.id = q.created_by_member_id
    WHERE ${where}
    ORDER BY q.created_at DESC
    LIMIT $${limitPosition}
    OFFSET $${offsetPosition}
    `,
    params
  );

  return result.rows;
}

async function updateQuestion(
  schoolId,
  questionId,
  payload = {}
) {
  const pool = getPool();
  const existing = await getQuestionById(
    schoolId,
    questionId
  );

  const subjectId = hasOwn(payload, 'subjectId')
    ? requireText(payload.subjectId, 'Subject ID')
    : existing.subject_id;

  const classId = hasOwn(payload, 'classId')
    ? clean(payload.classId)
    : existing.class_id;

  await assertSchoolRecord(
    pool,
    'school_subjects',
    subjectId,
    schoolId,
    'Subject'
  );

  if (classId) {
    await assertSchoolRecord(
      pool,
      'school_classes',
      classId,
      schoolId,
      'Class'
    );
  }

  const questionType = hasOwn(payload, 'questionType')
    ? normalizeQuestionType(payload.questionType)
    : existing.question_type;

  const suppliedOptions = hasOwn(payload, 'options')
    ? payload.options
    : existing.options;

  const options = normalizeOptions(
    questionType,
    suppliedOptions
  );

  let suppliedAnswerKey;

  if (hasOwn(payload, 'answerKey')) {
    suppliedAnswerKey = payload.answerKey;
  } else if (hasOwn(payload, 'correctAnswer')) {
    suppliedAnswerKey = payload.correctAnswer;
  } else {
    suppliedAnswerKey = existing.answer_key;
  }

  const answerKey = normalizeAnswerKey(
    questionType,
    suppliedAnswerKey,
    options
  );

  const result = await pool.query(
    `
    UPDATE school_question_bank
    SET
      subject_id = $3,
      class_id = $4,
      topic = $5,
      subtopic = $6,
      curriculum = $7,
      syllabus_reference = $8,
      question_type = $9,
      question_text = $10,
      options = $11::jsonb,
      answer_key = $12::jsonb,
      explanation = $13,
      difficulty = $14,
      default_marks = $15,
      default_negative_marks = $16,
      media = $17::jsonb,
      source = $18,
      language_code = $19,
      status = $20,
      version = version + 1,
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [
      questionId,
      schoolId,
      subjectId,
      classId,
      hasOwn(payload, 'topic')
        ? clean(payload.topic)
        : existing.topic,
      hasOwn(payload, 'subtopic')
        ? clean(payload.subtopic)
        : existing.subtopic,
      hasOwn(payload, 'curriculum')
        ? clean(payload.curriculum)
        : existing.curriculum,
      hasOwn(payload, 'syllabusReference')
        ? clean(payload.syllabusReference)
        : existing.syllabus_reference,
      questionType,
      hasOwn(payload, 'questionText')
        ? requireText(payload.questionText, 'Question text')
        : existing.question_text,
      JSON.stringify(options),
      answerKey === null ? null : JSON.stringify(answerKey),
      hasOwn(payload, 'explanation')
        ? clean(payload.explanation)
        : existing.explanation,
      hasOwn(payload, 'difficulty')
        ? normalizeDifficulty(payload.difficulty)
        : existing.difficulty,
      hasOwn(payload, 'defaultMarks')
        ? normalizeNumber(
            payload.defaultMarks,
            existing.default_marks,
            'Default marks',
            0.01
          )
        : Number(existing.default_marks),
      hasOwn(payload, 'defaultNegativeMarks')
        ? normalizeNumber(
            payload.defaultNegativeMarks,
            existing.default_negative_marks,
            'Default negative marks',
            0
          )
        : Number(existing.default_negative_marks),
      JSON.stringify(
        hasOwn(payload, 'media')
          ? payload.media || {}
          : existing.media || {}
      ),
      hasOwn(payload, 'source')
        ? clean(payload.source)
        : existing.source,
      hasOwn(payload, 'languageCode')
        ? clean(payload.languageCode) || 'en'
        : existing.language_code,
      hasOwn(payload, 'status')
        ? normalizeStatus(payload.status)
        : existing.status,
    ]
  );

  return getQuestionById(schoolId, result.rows[0].id);
}

async function archiveQuestion(schoolId, questionId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_question_bank
    SET
      status = 'archived',
      deleted_at = now(),
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [questionId, schoolId]
  );

  if (!result.rows.length) {
    throw createError('Question not found', 404);
  }

  return result.rows[0];
}

async function getExamAndQuestion(
  pool,
  schoolId,
  examId,
  questionId
) {
  const result = await pool.query(
    `
    SELECT
      e.id AS exam_id,
      e.subject_id AS exam_subject_id,
      e.status AS exam_status,
      q.id AS question_id,
      q.subject_id AS question_subject_id,
      q.default_marks,
      q.default_negative_marks,
      q.status AS question_status
    FROM school_exams e
    JOIN school_question_bank q
      ON q.id = $3
    WHERE e.id = $2
      AND e.school_id = $1
      AND q.school_id = $1
      AND e.deleted_at IS NULL
      AND q.deleted_at IS NULL
    LIMIT 1
    `,
    [schoolId, examId, questionId]
  );

  if (!result.rows.length) {
    throw createError(
      'Exam or question was not found in this school',
      404
    );
  }

  const row = result.rows[0];

  if (row.exam_subject_id !== row.question_subject_id) {
    throw createError(
      'The question subject does not match the exam subject'
    );
  }

  if (row.question_status === 'archived') {
    throw createError(
      'Archived questions cannot be attached to an exam'
    );
  }

  return row;
}

async function attachQuestionToExam(
  schoolId,
  examId,
  questionId,
  payload = {}
) {
  const pool = getPool();

  const record = await getExamAndQuestion(
    pool,
    schoolId,
    examId,
    questionId
  );

  let position = Number(payload.position);

  if (!Number.isInteger(position) || position <= 0) {
    const positionResult = await pool.query(
      `
      SELECT COALESCE(MAX(position), 0) + 1 AS next_position
      FROM school_exam_questions
      WHERE exam_id = $1
      `,
      [examId]
    );

    position = Number(
      positionResult.rows[0].next_position
    );
  }

  const marks = normalizeNumber(
    payload.marks,
    Number(record.default_marks),
    'Marks',
    0.01
  );

  const negativeMarks = normalizeNumber(
    payload.negativeMarks,
    Number(record.default_negative_marks),
    'Negative marks',
    0
  );

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
    [
      schoolId,
      examId,
      questionId,
      position,
      marks,
      negativeMarks,
      payload.isRequired === undefined
        ? true
        : Boolean(payload.isRequired),
    ]
  );

  return result.rows[0];
}

async function detachQuestionFromExam(
  schoolId,
  examId,
  questionId
) {
  const pool = getPool();

  const result = await pool.query(
    `
    DELETE FROM school_exam_questions
    WHERE school_id = $1
      AND exam_id = $2
      AND question_id = $3
    RETURNING *
    `,
    [schoolId, examId, questionId]
  );

  if (!result.rows.length) {
    throw createError(
      'Question is not attached to this exam',
      404
    );
  }

  return result.rows[0];
}

async function listExamQuestions(schoolId, examId) {
  const pool = getPool();

  const examResult = await pool.query(
    `
    SELECT id
    FROM school_exams
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [examId, schoolId]
  );

  if (!examResult.rows.length) {
    throw createError('Exam not found', 404);
  }

  const result = await pool.query(
    `
    SELECT
      eq.id AS exam_question_id,
      eq.exam_id,
      eq.question_id,
      eq.position,
      eq.marks,
      eq.negative_marks,
      eq.is_required,
      q.question_type,
      q.question_text,
      q.options,
      q.answer_key,
      q.explanation,
      q.topic,
      q.subtopic,
      q.difficulty,
      q.media,
      q.source,
      s.name AS subject_name,
      s.code AS subject_code
    FROM school_exam_questions eq
    JOIN school_question_bank q
      ON q.id = eq.question_id
    JOIN school_subjects s
      ON s.id = q.subject_id
    WHERE eq.school_id = $1
      AND eq.exam_id = $2
      AND q.deleted_at IS NULL
    ORDER BY eq.position ASC, eq.created_at ASC
    `,
    [schoolId, examId]
  );

  return result.rows;
}

module.exports = {
  createQuestion,
  listQuestions,
  getQuestionById,
  updateQuestion,
  archiveQuestion,
  attachQuestionToExam,
  detachQuestionFromExam,
  listExamQuestions,
};
