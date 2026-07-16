const db = require('../db');

async function generateRecommendations(userId) {
  // Weak topics
  const weak = await db.query(
    `
    SELECT topic_id, weak_score
    FROM student_topic_mastery
    WHERE user_id = $1
    ORDER BY weak_score DESC
    LIMIT 3
    `,
    [userId]
  );

  for (const row of weak.rows) {
    await db.query(
      `
      INSERT INTO student_recommendations (user_id, topic_id, title, reason, priority)
      VALUES ($1, $2, 'Practice weak topic', 'Low mastery detected', 10)
      `,
      [userId, row.topic_id]
    );
  }
}

module.exports = { generateRecommendations };
