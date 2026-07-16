const db = require('../db');

async function runPublisherOnce() {
  try {
    const result = await db.query(`SELECT process_publish_queue() AS result`);
    console.log('[question-publisher] result:', result.rows[0]?.result);
    return result.rows[0]?.result;
  } catch (err) {
    console.error('[QUESTION_PUBLISHER_RUN_ERROR]', {
      error: err.message,
      stack: err.stack
    });
    throw err;
  }
}

function startQuestionPublisherCron() {
  console.log('Question publisher cron started');

  setInterval(async () => {
    try {
      await runPublisherOnce();

      await db.query(`
        INSERT INTO topic_coverage (topic_id)
        SELECT DISTINCT topic_id
        FROM questions
        WHERE topic_id IS NOT NULL
        ON CONFLICT (topic_id) DO NOTHING
      `);

      const topics = await db.query(`
        SELECT DISTINCT topic_id
        FROM questions
        WHERE topic_id IS NOT NULL
        LIMIT 200
      `);

      for (const row of topics.rows) {
        await db.query(`SELECT update_topic_coverage($1)`, [row.topic_id]);
      }
    } catch (err) {
      console.error('[QUESTION_PUBLISHER_CRON_ERROR]', {
        error: err.message,
        stack: err.stack
      });
    }
  }, 60 * 1000);
}

module.exports = {
  startQuestionPublisherCron,
  runPublisherOnce
};
