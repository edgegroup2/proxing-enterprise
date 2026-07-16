const db = require('../db');

async function queueWrongAnswer({
  userId,
  examSessionId,
  questionId,
  sourceTable,
  sourceQuestionId,
  topicId,
  topicName,
  subject,
  examType,
  responseTime,
}) {
  const safeSourceTable = ['questions', 'past_questions'].includes(sourceTable)
    ? sourceTable
    : 'questions';

  const realSourceQuestionId = sourceQuestionId || questionId;

  if (!userId || !realSourceQuestionId) return null;

  const finalQuestionId =
    safeSourceTable === 'questions' ? questionId : null;

  const result = await db.query(
    `
    INSERT INTO student_review_queue (
      user_id,
      exam_session_id,
      question_id,
      source_table,
      source_question_id,
      topic_id,
      topic_name,
      subject,
      exam_type,
      reason,
      due_at,
      interval_days,
      ease_factor,
      repetitions,
      last_is_correct,
      last_response_time,
      status,
      updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,
      'wrong_answer',
      NOW(),
      1,
      2.50,
      0,
      false,
      $10,
      'due',
      NOW()
    )
    ON CONFLICT (user_id, source_table, source_question_id)
    DO UPDATE SET
      exam_session_id = EXCLUDED.exam_session_id,
      question_id = EXCLUDED.question_id,
      topic_id = EXCLUDED.topic_id,
      topic_name = EXCLUDED.topic_name,
      subject = EXCLUDED.subject,
      exam_type = EXCLUDED.exam_type,
      reason = 'wrong_answer',
      due_at = NOW() + INTERVAL '1 day',
      last_is_correct = false,
      last_response_time = EXCLUDED.last_response_time,
      status = 'due',
      updated_at = NOW()
    RETURNING *
    `,
    [
      userId,
      examSessionId || null,
      finalQuestionId,
      safeSourceTable,
      realSourceQuestionId,
      topicId || null,
      topicName || null,
      subject || null,
      examType || null,
      responseTime || null,
    ]
  );

  return result.rows[0];
}

module.exports = {
  queueWrongAnswer,
};
