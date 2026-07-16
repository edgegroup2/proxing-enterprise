const db = require('../db');

async function scheduleReview(userId, topicId) {
  await db.query(
    `
    INSERT INTO student_review_queue (user_id, topic_id, priority, due_at)
    VALUES ($1, $2, 7, now() + interval '1 day')
    `,
    [userId, topicId]
  );
}

async function getDueReviews(userId) {
  const { rows } = await db.query(
    `
    SELECT * FROM student_review_queue
    WHERE user_id = $1
    AND completed_at IS NULL
    AND due_at <= now()
    ORDER BY priority DESC
    LIMIT 10
    `,
    [userId]
  );
  return rows;
}

module.exports = { scheduleReview, getDueReviews };
