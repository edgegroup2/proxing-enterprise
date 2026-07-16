const db = require('../db');

async function recordAttempt({
  userId,
  questionId,
  topicId,
  subjectId,
  selectedOptionId,
  isCorrect,
  timeSpentSec
}) {
  await db.query(
    `
    INSERT INTO student_question_attempts
    (user_id, question_id, topic_id, subject_id, selected_option_id, is_correct, time_spent_sec)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    `,
    [userId, questionId, topicId, subjectId, selectedOptionId, isCorrect, timeSpentSec]
  );
}

module.exports = { recordAttempt };
