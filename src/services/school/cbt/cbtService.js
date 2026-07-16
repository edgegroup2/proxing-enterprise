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

function err(message, statusCode = 400) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

function sameAnswer(questionType, answer, answerKey) {
  if (questionType === 'single_choice' || questionType === 'true_false') {
    return String(answer) === String(answerKey);
  }

  if (questionType === 'multiple_choice') {
    const a = Array.isArray(answer) ? answer.map(String).sort() : [];
    const k = Array.isArray(answerKey) ? answerKey.map(String).sort() : [];
    return JSON.stringify(a) === JSON.stringify(k);
  }

  if (questionType === 'short_answer') {
    return String(answer || '').trim().toLowerCase() === String(answerKey || '').trim().toLowerCase();
  }

  return false;
}

async function startExamSession(schoolId, payload = {}) {
  const pool = getPool();

  const examId = clean(payload.examId);
  const studentId = clean(payload.studentId);
  const classId = clean(payload.classId);

  if (!examId) throw err('Exam ID is required');
  if (!studentId) throw err('Student ID is required');
  if (!classId) throw err('Class ID is required');

  const examResult = await pool.query(
    `
    SELECT id, duration_minutes, status
    FROM school_exams
    WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
    LIMIT 1
    `,
    [examId, schoolId]
  );

  if (!examResult.rows.length) throw err('Exam not found', 404);

  const exam = examResult.rows[0];

  if (!['draft', 'published'].includes(exam.status)) {
    throw err('Exam is not available');
  }

  const result = await pool.query(
    `
    INSERT INTO school_exam_sessions (
      school_id,
      exam_id,
      student_id,
      class_id,
      expires_at,
      status
    )
    VALUES (
      $1,$2,$3,$4,
      now() + ($5 || ' minutes')::interval,
      'in_progress'
    )
    ON CONFLICT (school_id, exam_id, student_id)
    DO UPDATE SET
      updated_at = now()
    RETURNING *
    `,
    [schoolId, examId, studentId, classId, Number(exam.duration_minutes || 60)]
  );

  return result.rows[0];
}

async function getSessionQuestions(schoolId, sessionId) {
  const pool = getPool();

  const sessionResult = await pool.query(
    `
    SELECT ses.*, ex.shuffle_questions
    FROM school_exam_sessions ses
    JOIN school_exams ex ON ex.id = ses.exam_id
    WHERE ses.id = $1 AND ses.school_id = $2
    LIMIT 1
    `,
    [sessionId, schoolId]
  );

  if (!sessionResult.rows.length) throw err('Exam session not found', 404);

  const result = await pool.query(
    `
    SELECT
      eq.question_id,
      eq.position,
      eq.marks,
      eq.negative_marks,
      q.question_type,
      q.question_text,
      q.options,
      q.topic,
      q.subtopic,
      q.difficulty,
      q.media
    FROM school_exam_questions eq
    JOIN school_question_bank q ON q.id = eq.question_id
    WHERE eq.school_id = $1
      AND eq.exam_id = $2
      AND q.deleted_at IS NULL
    ORDER BY eq.position ASC
    `,
    [schoolId, sessionResult.rows[0].exam_id]
  );

  return {
    session: sessionResult.rows[0],
    questions: result.rows,
  };
}

async function saveAnswer(schoolId, sessionId, payload = {}) {
  const pool = getPool();

  const questionId = clean(payload.questionId);
  if (!questionId) throw err('Question ID is required');

  const sessionResult = await pool.query(
    `
    SELECT *
    FROM school_exam_sessions
    WHERE id = $1
      AND school_id = $2
      AND status = 'in_progress'
    LIMIT 1
    `,
    [sessionId, schoolId]
  );

  if (!sessionResult.rows.length) throw err('Active session not found', 404);

  const session = sessionResult.rows[0];

  const result = await pool.query(
    `
    INSERT INTO school_exam_answers (
      school_id,
      session_id,
      exam_id,
      student_id,
      question_id,
      answer,
      answer_text,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'saved')
    ON CONFLICT (session_id, question_id)
    DO UPDATE SET
      answer = EXCLUDED.answer,
      answer_text = EXCLUDED.answer_text,
      status = 'saved',
      updated_at = now()
    RETURNING *
    `,
    [
      schoolId,
      sessionId,
      session.exam_id,
      session.student_id,
      questionId,
      payload.answer === undefined ? null : JSON.stringify(payload.answer),
      clean(payload.answerText),
    ]
  );

  return result.rows[0];
}

async function submitSession(schoolId, sessionId, mode = 'submitted') {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const sessionResult = await client.query(
      `
      SELECT *
      FROM school_exam_sessions
      WHERE id = $1
        AND school_id = $2
      FOR UPDATE
      `,
      [sessionId, schoolId]
    );

    if (!sessionResult.rows.length) throw err('Session not found', 404);

    const session = sessionResult.rows[0];

    const questionsResult = await client.query(
      `
      SELECT
        eq.question_id,
        eq.marks,
        eq.negative_marks,
        q.question_type,
        q.answer_key
      FROM school_exam_questions eq
      JOIN school_question_bank q ON q.id = eq.question_id
      WHERE eq.school_id = $1
        AND eq.exam_id = $2
      `,
      [schoolId, session.exam_id]
    );

    let objectiveScore = 0;
    let totalMarks = 0;

    for (const question of questionsResult.rows) {
      totalMarks += Number(question.marks || 0);

      const answerResult = await client.query(
        `
        SELECT *
        FROM school_exam_answers
        WHERE session_id = $1 AND question_id = $2
        LIMIT 1
        `,
        [sessionId, question.question_id]
      );

      const answerRow = answerResult.rows[0];
      const questionType = question.question_type;

      if (!answerRow) {
        await client.query(
          `
          INSERT INTO school_exam_answers (
            school_id, session_id, exam_id, student_id, question_id,
            status, auto_score, final_score
          )
          VALUES ($1,$2,$3,$4,$5,$6,0,0)
          `,
          [
            schoolId,
            sessionId,
            session.exam_id,
            session.student_id,
            question.question_id,
            ['essay'].includes(questionType) ? 'needs_manual_marking' : 'auto_marked',
          ]
        );
        continue;
      }

      if (['essay'].includes(questionType)) {
        await client.query(
          `
          UPDATE school_exam_answers
          SET status = 'needs_manual_marking',
              updated_at = now()
          WHERE id = $1
          `,
          [answerRow.id]
        );
        continue;
      }

      const candidateAnswer =
        answerRow.answer !== null && answerRow.answer !== undefined
          ? answerRow.answer
          : answerRow.answer_text;

      const correct = sameAnswer(questionType, candidateAnswer, question.answer_key);
      const autoScore = correct ? Number(question.marks) : 0;

      objectiveScore += autoScore;

      await client.query(
        `
        UPDATE school_exam_answers
        SET
          is_correct = $2,
          auto_score = $3,
          final_score = $3,
          status = 'auto_marked',
          updated_at = now()
        WHERE id = $1
        `,
        [answerRow.id, correct, autoScore]
      );
    }

    const percentage = totalMarks ? Number(((objectiveScore / totalMarks) * 100).toFixed(2)) : 0;

    await client.query(
      `
      UPDATE school_exam_sessions
      SET
        status = $3,
        submitted_at = now(),
        objective_score = $4,
        total_score = $4 + theory_score,
        total_marks = $5,
        percentage = $6,
        updated_at = now()
      WHERE id = $1 AND school_id = $2
      `,
      [
        sessionId,
        schoolId,
        mode === 'auto_submitted' ? 'auto_submitted' : 'submitted',
        objectiveScore,
        totalMarks,
        percentage,
      ]
    );

    await client.query('COMMIT');

    return getSessionResult(schoolId, sessionId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markTheoryAnswer(schoolId, memberId, answerId, payload = {}) {
  const pool = getPool();

  const score = Number(payload.score);
  if (!Number.isFinite(score) || score < 0) throw err('Score must be valid');

  const result = await pool.query(
    `
    UPDATE school_exam_answers
    SET
      manual_score = $3,
      final_score = $3,
      marker_member_id = $4,
      marker_comment = $5,
      status = 'marked',
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
    RETURNING *
    `,
    [answerId, schoolId, score, clean(memberId), clean(payload.comment)]
  );

  if (!result.rows.length) throw err('Answer not found', 404);

  await recomputeSessionScore(schoolId, result.rows[0].session_id);

  return result.rows[0];
}

async function recomputeSessionScore(schoolId, sessionId) {
  const pool = getPool();

  const sumResult = await pool.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN status = 'auto_marked' THEN final_score ELSE 0 END),0) AS objective_score,
      COALESCE(SUM(CASE WHEN status = 'marked' THEN final_score ELSE 0 END),0) AS theory_score,
      COALESCE(SUM(final_score),0) AS total_score
    FROM school_exam_answers
    WHERE school_id = $1 AND session_id = $2
    `,
    [schoolId, sessionId]
  );

  const marksResult = await pool.query(
    `
    SELECT COALESCE(SUM(eq.marks),0) AS total_marks
    FROM school_exam_sessions ses
    JOIN school_exam_questions eq ON eq.exam_id = ses.exam_id
    WHERE ses.id = $1 AND ses.school_id = $2
    `,
    [sessionId, schoolId]
  );

  const scores = sumResult.rows[0];
  const totalMarks = Number(marksResult.rows[0].total_marks || 0);
  const totalScore = Number(scores.total_score || 0);
  const percentage = totalMarks ? Number(((totalScore / totalMarks) * 100).toFixed(2)) : 0;

  await pool.query(
    `
    UPDATE school_exam_sessions
    SET
      objective_score = $3,
      theory_score = $4,
      total_score = $5,
      total_marks = $6,
      percentage = $7,
      status = 'marked',
      updated_at = now()
    WHERE id = $1 AND school_id = $2
    `,
    [
      sessionId,
      schoolId,
      Number(scores.objective_score || 0),
      Number(scores.theory_score || 0),
      totalScore,
      totalMarks,
      percentage,
    ]
  );
}

async function getSessionResult(schoolId, sessionId) {
  const pool = getPool();

  const sessionResult = await pool.query(
    `
    SELECT *
    FROM school_exam_sessions
    WHERE id = $1 AND school_id = $2
    LIMIT 1
    `,
    [sessionId, schoolId]
  );

  if (!sessionResult.rows.length) throw err('Session not found', 404);

  const answersResult = await pool.query(
    `
    SELECT
      a.*,
      q.question_text,
      q.question_type
    FROM school_exam_answers a
    JOIN school_question_bank q ON q.id = a.question_id
    WHERE a.session_id = $1 AND a.school_id = $2
    ORDER BY a.created_at ASC
    `,
    [sessionId, schoolId]
  );

  return {
    session: sessionResult.rows[0],
    answers: answersResult.rows,
  };
}

module.exports = {
  startExamSession,
  getSessionQuestions,
  saveAnswer,
  submitSession,
  markTheoryAnswer,
  getSessionResult,
};
