'use strict';

const db = require('../db');

async function queueRetry(reference, payload, error) {
  await db.query(
    `
    INSERT INTO job_retries (reference, payload, last_error, next_retry_at)
    VALUES ($1,$2,$3,NOW() + INTERVAL '2 minutes')
    `,
    [reference, payload, error]
  );
}

module.exports = { queueRetry };
