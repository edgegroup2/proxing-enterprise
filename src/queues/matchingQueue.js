'use strict';

const db = require('../../db');

async function fetchNextQueuedMatchRequest() {
  const result = await db.query(
    `
      SELECT *
      FROM match_requests
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
    `
  );

  return result.rows[0] || null;
}

async function markProcessing(requestId) {
  await db.query(
    `
      UPDATE match_requests
      SET status = 'processing',
          updated_at = NOW()
      WHERE id = $1
    `,
    [requestId]
  );
}

module.exports = {
  fetchNextQueuedMatchRequest,
  markProcessing
};
